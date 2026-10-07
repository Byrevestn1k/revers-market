import type { PoolClient } from 'pg';
import type { AuthUser } from './auth.js';
import { pool } from './db/client.js';
import { getSettlement, listSettlementRegions } from './settlements.js';
import { countryDialCodes } from './validation.js';
import { REQUEST_UNITS } from './buy-request-validation.js';
import { matchesDemandCriteria, RECEIPT_METHODS, type DemandCriteria, type MatchRequest } from './demand-matching.js';
import { requestPublicLocationSql } from './request-public-location.js';

type Queryable = Pick<PoolClient, 'query'>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const regions = new Set(listSettlementRegions().regions);
const notFound = () => ({ status: 404, body: { error: 'SUBSCRIPTION_NOT_FOUND', message: 'Підписку не знайдено' } });
const invalid = (fields: string[]) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте критерії підписки: ' + fields.join(', '), fields } });

export type DemandSubscription = DemandCriteria & {
  id: string;
  category: { id: string; name: string };
  region: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const select = `SELECT s.id, json_build_object('id', c.id, 'name', c.name) AS category,
    s.region, s.active, s.country_code AS "countryCode", s.settlement_codes AS "settlementCodes",
    CASE WHEN s.radius_km IS NOT NULL THEN json_build_object('latitude', s.center_latitude::float8, 'longitude', s.center_longitude::float8) ELSE NULL END AS center,
    s.radius_km::float8 AS "radiusKm", s.min_quantity::float8 AS "minQuantity", s.max_quantity::float8 AS "maxQuantity", s.unit,
    s.min_price::float8 AS "minPrice", s.max_price::float8 AS "maxPrice", s.currency, s.receipt_methods AS "receiptMethods",
    s.created_at AS "createdAt", s.updated_at AS "updatedAt"
    FROM demand_subscriptions s JOIN categories c ON c.id = s.category_id`;

const columns: Record<string, string> = {
  categoryId: 'category_id', region: 'region', active: 'active', countryCode: 'country_code', settlementCodes: 'settlement_codes',
  centerLatitude: 'center_latitude', centerLongitude: 'center_longitude', radiusKm: 'radius_km',
  minQuantity: 'min_quantity', maxQuantity: 'max_quantity', unit: 'unit', minPrice: 'min_price', maxPrice: 'max_price', currency: 'currency', receiptMethods: 'receipt_methods',
};
const defaults = { countryCode: null, region: null, settlementCodes: [], center: null, radiusKm: null,
  minQuantity: null, maxQuantity: null, unit: null, minPrice: null, maxPrice: null, currency: null, receiptMethods: [], active: true };
const inputKeys = ['categoryId', ...Object.keys(defaults)];
const dto = (row: DemandSubscription) => ({ ...row, settlements: row.settlementCodes.map(getSettlement).filter(Boolean) });

export const validateDemandSubscription = (input: Record<string, unknown>, partial = false): string[] => {
  const fields: string[] = [];
  if (Object.keys(input).some(key => !inputKeys.includes(key))) fields.push('subscription');
  if ((!partial || 'categoryId' in input) && (typeof input.categoryId !== 'string' || !uuidPattern.test(input.categoryId))) fields.push('categoryId');
  if ('region' in input && input.region !== null && (typeof input.region !== 'string' || !regions.has(input.region))) fields.push('region');
  if ('active' in input && typeof input.active !== 'boolean') fields.push('active');
  if (input.countryCode != null && (typeof input.countryCode !== 'string' || !countryDialCodes[input.countryCode])) fields.push('countryCode');
  if ('settlementCodes' in input && (!Array.isArray(input.settlementCodes) || input.settlementCodes.length > 30 || input.settlementCodes.some(code => !getSettlement(code)) || new Set(input.settlementCodes).size !== input.settlementCodes.length)) fields.push('settlementCodes');
  if (input.unit != null && !REQUEST_UNITS.includes(input.unit as typeof REQUEST_UNITS[number])) fields.push('unit');
  if (input.currency != null && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) fields.push('currency');
  for (const field of ['minQuantity', 'maxQuantity', 'minPrice', 'maxPrice']) {
    const value = input[field];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12 || field.includes('Quantity') && value === 0 || Math.abs(value * 10000 - Math.round(value * 10000)) > 0.001)) fields.push(field);
  }
  if (input.radiusKm != null && (typeof input.radiusKm !== 'number' || !Number.isFinite(input.radiusKm) || input.radiusKm < 0.2 || input.radiusKm > 200)) fields.push('radiusKm');
  if (input.center != null) {
    const point = input.center as Record<string, unknown>;
    if (typeof input.center !== 'object' || Array.isArray(input.center) || Object.keys(point).some(key => !['latitude','longitude'].includes(key))
      || typeof point.latitude !== 'number' || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
      || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) fields.push('center');
  }
  if ('receiptMethods' in input && (!Array.isArray(input.receiptMethods) || input.receiptMethods.some(method => !RECEIPT_METHODS.includes(method)) || new Set(input.receiptMethods).size !== input.receiptMethods.length)) fields.push('receiptMethods');
  if (!partial && !fields.length) {
    const codes = (input.settlementCodes ?? []) as string[];
    if (!input.countryCode && !input.region && !codes.length) fields.push('geography');
    if ((input.region || codes.length) && input.countryCode != null && input.countryCode !== 'UA') fields.push('countryCode');
    if (input.region && codes.some(code => getSettlement(code)!.region !== input.region)) fields.push('settlementCodes');
    if ((input.center == null) !== (input.radiusKm == null)) fields.push('radiusKm');
    if (input.minQuantity != null && input.maxQuantity != null && Number(input.minQuantity) > Number(input.maxQuantity)) fields.push('quantityRange');
    if (input.minPrice != null && input.maxPrice != null && Number(input.minPrice) > Number(input.maxPrice)) fields.push('priceRange');
    if ((input.minQuantity != null || input.maxQuantity != null || input.minPrice != null || input.maxPrice != null) && !input.unit) fields.push('unit');
    if ((input.minPrice != null || input.maxPrice != null) && !input.currency) fields.push('currency');
  }
  if (partial && !Object.keys(input).length) fields.push('subscription');
  return fields;
};

export const listDemandSubscriptions = async (user: AuthUser) => {
  const result = await pool.query<DemandSubscription>(`${select} WHERE s.user_id = $1 ORDER BY s.created_at DESC, s.id DESC`, [user.id]);
  return { status: 200, body: { subscriptions: result.rows.map(dto) } };
};

export const getDemandSubscription = async (user: AuthUser, id: string) => {
  if (!uuidPattern.test(id)) return notFound();
  const result = await pool.query<DemandSubscription>(`${select} WHERE s.id = $1 AND s.user_id = $2`, [id, user.id]);
  return result.rowCount ? { status: 200, body: { subscription: dto(result.rows[0]) } } : notFound();
};

export const saveDemandSubscription = async (user: AuthUser, input: Record<string, unknown>, id?: string) => {
  if (id !== undefined && !uuidPattern.test(id)) return notFound();
  const fields = validateDemandSubscription(input, id !== undefined);
  if (fields.length) return invalid(fields);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = id === undefined ? null : (await client.query<DemandSubscription>(`${select} WHERE s.id = $1 AND s.user_id = $2 FOR UPDATE OF s`, [id, user.id])).rows[0];
    if (id !== undefined && !current) { await client.query('ROLLBACK'); return notFound(); }
    const previous = current ? Object.fromEntries(Object.keys(defaults).map(key => [key, current[key as keyof DemandSubscription]])) : defaults;
    const merged = { ...previous, categoryId: current?.category.id, ...input };
    const errors = validateDemandSubscription(merged);
    if (errors.length) { await client.query('ROLLBACK'); return invalid(errors); }
    if ((id === undefined || input.categoryId !== undefined || input.active === true) && !(await client.query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [merged.categoryId])).rowCount) { await client.query('ROLLBACK'); return invalid(['categoryId']); }
    const criteria = merged as unknown as DemandCriteria;
    const record = { ...merged, countryCode: criteria.countryCode ?? (criteria.region || criteria.settlementCodes.length ? 'UA' : null), centerLatitude: criteria.center?.latitude ?? null, centerLongitude: criteria.center?.longitude ?? null };
    const keys = Object.keys(columns);
    const values = keys.map(key => record[key as keyof typeof record]);
    const result = id === undefined
      ? await client.query<{ id: string }>(`INSERT INTO demand_subscriptions (${keys.map(key => columns[key]).join(',')}, user_id) VALUES (${keys.map((_, index) => '$' + (index + 1)).join(',')},$${values.length + 1}) RETURNING id`, [...values, user.id])
      : await client.query<{ id: string }>(`UPDATE demand_subscriptions SET ${keys.map((key, index) => columns[key] + ' = $' + (index + 1)).join(',')}, updated_at = now() WHERE id = $${values.length + 1} AND user_id = $${values.length + 2} RETURNING id`, [...values, id, user.id]);
    const response = (await client.query<DemandSubscription>(`${select} WHERE s.id = $1 AND s.user_id = $2`, [result.rows[0].id, user.id])).rows[0];
    await client.query('COMMIT');
    return { status: id === undefined ? 201 : 200, body: { subscription: dto(response) } };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};

export const deleteDemandSubscription = async (user: AuthUser, id: string) => {
  if (!uuidPattern.test(id)) return notFound();
  const result = await pool.query('DELETE FROM demand_subscriptions WHERE id = $1 AND user_id = $2', [id, user.id]);
  return result.rowCount ? { status: 204 } : notFound();
};

// Called inside the Request creation transaction. Use exactly the map's public projection.
export const notifyDemandSubscriptions = async (queryable: Queryable, requestId: string) => {
  const request = await queryable.query(`SELECT r.category_id, r.buyer_id, public_point.settlement_code, r.created_at,
      COALESCE(r.country_code, CASE WHEN public_point.settlement_code IS NOT NULL THEN 'UA' END) AS country_code,
      r.requested_quantity::float8 AS quantity, r.unit, r.min_unit_price::float8 AS min_price,
      r.max_unit_price::float8 AS max_price, r.currency, r.receipt_method,
      public_point.latitude::float8 AS public_latitude, public_point.longitude::float8 AS public_longitude
      FROM buy_requests r JOIN users u ON u.id = r.buyer_id ${requestPublicLocationSql}
      WHERE r.id = $1 AND r.status = 'open'`, [requestId]);
  if (!request.rowCount) return;
  const row = request.rows[0];
  const region = getSettlement(row.settlement_code)?.region ?? null;
  const candidates = await queryable.query<DemandSubscription>(`WITH RECURSIVE request_categories AS (
      SELECT id, parent_id FROM categories WHERE id = $1 AND is_active
      UNION
      SELECT c.id, c.parent_id FROM categories c JOIN request_categories child ON child.parent_id = c.id WHERE c.is_active
    ) ${select}
      WHERE s.active AND s.user_id <> $2 AND s.category_id IN (SELECT id FROM request_categories)
        AND (s.region IS NULL OR s.region = $3) AND s.created_at <= $4
      FOR SHARE OF s`, [row.category_id, row.buyer_id, region, row.created_at]);
  const publicRequest: MatchRequest = { countryCode: row.country_code, region, settlementCode: row.settlement_code,
    publicPoint: row.public_latitude == null || row.public_longitude == null ? null : { latitude: row.public_latitude, longitude: row.public_longitude },
    quantity: row.quantity, unit: row.unit, minPrice: row.min_price, maxPrice: row.max_price, currency: row.currency.trim(), receiptMethod: row.receipt_method };
  const ids = candidates.rows.filter(item => matchesDemandCriteria(item, publicRequest)).map(item => item.id);
  if (!ids.length) return;
  await queryable.query(`
    INSERT INTO notifications (user_id, type, title, body, context, buy_request_id, demand_subscription_id)
    SELECT s.user_id, 'system', left('Новий запит у категорії ' || c.name, 160), 'Перегляньте запит покупця.', 'selling', $1, s.id
    FROM demand_subscriptions s JOIN categories c ON c.id = s.category_id WHERE s.id = ANY($2::uuid[])
    ON CONFLICT (demand_subscription_id, buy_request_id) WHERE demand_subscription_id IS NOT NULL DO NOTHING`,
  [requestId, ids]);
};
