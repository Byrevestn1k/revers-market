import type { PoolClient } from 'pg';
import type { RequestHandler } from 'express';
import { pool } from './db/client.js';
import { searchTokens } from './smart-search.js';

type Queryable = Pick<PoolClient, 'query'>;
type Category = { id: string; parent_id: string | null; code: string; name: string };
export type CategorySuggestion = { id: string; name: string; path: string };
export type CategoryAssessment = { level: 'allow' | 'warn' | 'block'; reason: string | null; suggestions: CategorySuggestion[] };

// These are product nouns, not incidental words in a description. The order resolves
// compounds such as "медогонка" and "медичний" before the food sense of "мед".
const subjects = [
  { pattern: /(?:^|\s)(?:чохл\S*|чехл\S*)\s+автомоб\S*(?=\s|$)/u, codes: ['market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky'], family: 'accessory' },
  { pattern: /(?:^|\s)(?:обладнанн\S*|оборудован\S*|насос\S*)\s+для\s+(?:фасуванн\S*\s+)?(?:меду|меда|бджільництв\S*|пчеловодств\S*)(?=\s|$)/u, codes: ['market-business-services--prodazh-obladnannya-dlya-biznesu--promyslove-obladnannya'], family: 'equipment' },
  { pattern: /(?:^|\s)(?:медогонк\S*|медогон\S*|honey\s+extractor)(?=\s|$)/u, codes: ['market-business-services--prodazh-obladnannya-dlya-biznesu', 'apiculture'], family: 'equipment' },
  { pattern: /(?:^|\s)(?:медичн\S*|медицинск\S*)\s+халат\S*(?=\s|$)/u, codes: ['market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah'], family: 'clothes' },
  { pattern: /(?:^|\s)(?:причеп\S*|причіп\S*|прицеп\S*)(?=\s|$)/u, codes: ['market-auto--prychepy-budynky-na-kolesakh'], family: 'vehicle' },
  { pattern: /(?:^|\s)(?:автомобіл\S*|автомобил\S*|легков\S*\s+авто|renault\s+megane)(?=\s|$)/u, codes: ['market-auto--lehkovi-avtomobili'], family: 'vehicle' },
  { pattern: /(?:^|\s)(?:велосипед\S*|велосипєд\S*)(?=\s|$)/u, codes: ['market-hobbies--velo--velosypedy'], family: 'bike' },
  { pattern: /(?:^|\s)(?:мед|меду|мёд|меда|мёда)(?=\s|$)/u, codes: ['honey_raw'], family: 'food' },
  { pattern: /(?:^|\s)(?:цукор\S*|сахар\S*)(?=\s|$)/u, codes: ['processed_food'], family: 'food' },
  { pattern: /(?:^|\s)(?:молок\S*|молочн\S*)(?=\s|$)/u, codes: ['milk'], family: 'food' },
  { pattern: /(?:^|\s)(?:косметик\S*|помад\S*)(?=\s|$)/u, codes: ['market-fashion--krasa-zdorov-ya'], family: 'cosmetics' },
  { pattern: /(?:^|\s)(?:вулик\S*|вуликів|уль\S*|бджолин\S*\s+рамк\S*|пчелин\S*\s+рамк\S*)(?=\s|$)/u, codes: ['apiculture'], family: 'beekeeping' },
] as const;

const ambiguous = /(?:^|\s)(?:насос\S*|кабел\S*|зарядк\S*|батаре\S*|адаптер\S*|мотор\S*)(?=\s|$)/u;
const confirmingContext: Record<string, RegExp> = {
  food: /(?:натурал\S*|акаці\S*|липов\S*|гречан\S*|пасік\S*|відр\S*|ведр\S*|білий|белый|мішок|мешок|фасован\S*|свіж\S*|свеж\S*|коров\S*|фермер\S*|домашн\S*|оптом|куплю|продам|\d+\s*(?:л|кг))/u,
  bike: /(?:trek|giant|scott|гірськ\S*|горн\S*|дитяч\S*|детск\S*|міськ\S*|городск\S*|електро\S*)/u,
  vehicle: /(?:renault|toyota|ford|skoda|megane|легков\S*|двовіс\S*|двухос\S*|бортов\S*|вантажн\S*|перевез\S*|перевоз\S*|пасік\S*)/u,
  clothes: /(?:медичн\S*\s+халат\S*|медицинск\S*\s+халат\S*)/u,
  cosmetics: /(?:обличч\S*|волосс\S*|декоратив\S*|набір|набор|помада)/u,
  equipment: /(?:електричн\S*|электрическ\S*|фасуван\S*|фасовк\S*|бджільництв\S*|пчеловодств\S*)/u,
  accessory: /(?:автомоб\S*|авто)/u,
  beekeeping: /(?:дадан\S*|бджол\S*|пчел\S*|пасік\S*)/u,
};
const normalize = (text: string) => text.toLocaleLowerCase('uk-UA').replace(/[’ʼ`´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

let categoryCache: { expires: number; items: Category[] } | null = null;
async function categories(queryable: Queryable): Promise<Category[]> {
  if (categoryCache && categoryCache.expires > Date.now()) return categoryCache.items;
  const result = await queryable.query<Category>('SELECT id, parent_id, code, name FROM categories WHERE is_active');
  categoryCache = { expires: Date.now() + 60_000, items: result.rows };
  return result.rows;
}

export async function assessCategory(input: { title: string; description?: string; categoryId?: string; unit?: string }, queryable: Queryable = pool): Promise<CategoryAssessment> {
  const items = await categories(queryable);
  const byCode = new Map(items.map(item => [item.code, item]));
  const byId = new Map(items.map(item => [item.id, item]));
  const title = normalize(input.title.slice(0, 160));
  const description = normalize((input.description ?? '').slice(0, 5000));
  const subject = subjects.find(item => item.pattern.test(title));
  const descriptiveSubject = subjects.find(item => item.pattern.test(description));
  const detected = subject ?? descriptiveSubject;
  const chosen = input.categoryId ? byId.get(input.categoryId) : undefined;
  const path = (category: Category) => {
    const trail = [category.name];
    let parent = category.parent_id ? byId.get(category.parent_id) : undefined;
    while (parent && trail.length < 8) { trail.unshift(parent.name); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined; }
    return trail.join(' › ');
  };
  const categoryCandidates = detected?.codes.map(code => byCode.get(code)).filter((item): item is Category => Boolean(item)) ?? [];
  if (!categoryCandidates.length) {
    const words = searchTokens(input.title).filter(word => word.length >= 4);
    categoryCandidates.push(...items.map(item => {
      const name = normalize(item.name);
      const score = words.reduce((total, word) => total + (name.split(' ').some(part => part.length >= 4 && part.slice(0, 5) === word.slice(0, 5)) ? 1 : 0), 0);
      return { item, score };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'uk')).slice(0, 3).map(row => row.item));
  }
  const suggestions = categoryCandidates
    .map(item => ({ id: item.id, name: item.name, path: path(item) })).slice(0, 3);
  if (!chosen || !detected || !suggestions.length) return { level: 'allow', reason: null, suggestions };
  const acceptable = detected.codes.some(code => {
    const target = byCode.get(code);
    if (!target) return false;
    if (detected.family === 'equipment' && chosen.code === 'honey_raw') return false;
    let current: Category | undefined = chosen;
    while (current) { if (current.id === target.id) return true; current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    return false;
  });
  if (acceptable) return { level: 'allow', reason: null, suggestions };
  // No hard decision if title and description indicate different subjects,
  // or if the subject appears only in the description.
  const conflict = Boolean(subject && descriptiveSubject && subject.family !== descriptiveSubject.family);
  const strong = Boolean(subject && !conflict && !ambiguous.test(title) && title.split(' ').length >= 2 && confirmingContext[subject.family]?.test(title + ' ' + description));
  const chosenRoot = (() => { let item: Category | undefined = chosen; while (item?.parent_id) item = byId.get(item.parent_id); return item?.code; })();
  const detectedRoot = (() => { let item: Category | undefined = byCode.get(detected.codes[0]); while (item?.parent_id) item = byId.get(item.parent_id); return item?.code; })();
  const level = strong && chosenRoot && detectedRoot && chosenRoot !== detectedRoot ? 'block' : 'warn';
  return { level, reason: level === 'block'
    ? 'Обрана категорія не відповідає товару. Виберіть відповідну категорію або уточніть опис.'
    : 'Можливо, для цього оголошення більше підходить інша категорія.', suggestions };
}

export const categoryBlock = (assessment: CategoryAssessment) => ({ status: 422, body: {
  error: 'CATEGORY_MISMATCH', message: assessment.reason, suggestions: assessment.suggestions,
  appeal: 'Уточніть назву або опис. Якщо категорія правильна, подайте оскарження на перевірку.'
} });

export function createCategoryRecommendationRateLimit(): RequestHandler {
  const entries = new Map<string, { count: number; until: number }>();
  return (request, response, next) => {
    const now = Date.now();
    if (entries.size > 10_000) for (const [key, value] of entries) if (value.until <= now) entries.delete(key);
    const key = request.authUser?.id ?? request.socket.remoteAddress ?? 'unknown';
    const current = entries.get(key);
    if (!current && entries.size >= 10_000) { response.status(429).json({ error: 'CATEGORY_RATE_LIMIT' }); return; }
    const entry = current && current.until > now ? current : { count: 0, until: now + 60_000 };
    if (entry.count >= 60) { response.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000))); response.status(429).json({ error: 'CATEGORY_RATE_LIMIT' }); return; }
    entry.count++;
    entries.set(key, entry);
    next();
  };
}
