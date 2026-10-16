import SettlementPicker from './SettlementPicker';
import LocationPointPicker from './LocationPointPicker';
import './delivery-options.css';
import type { Settlement } from './settlement-model';

export type DeliveryMethod = 'SELF_PICKUP' | 'SELLER_DELIVERY' | 'POSTAL_DELIVERY' | 'FLEXIBLE';
export type DeliveryPlace = { settlementCode: string | null; region: string | null; publicPoint: { latitude: number; longitude: number } | null };
export type DeliveryOption = { method: DeliveryMethod; radiusKm?: number; region?: string; regions?: string[]; nationwide?: boolean; place?: DeliveryPlace };
const labels: Record<DeliveryMethod, string> = { SELF_PICKUP: 'Самовивіз', SELLER_DELIVERY: 'Доставка продавцем', POSTAL_DELIVERY: 'Поштова доставка', FLEXIBLE: 'Можна домовитися' };
export const deliveryOptionsLabel = (options: DeliveryOption[] | null | undefined) => options?.length ? options.map(option => {
  let territory = '';
  if (option.radiusKm !== undefined) territory = option.radiusKm === 0 ? 'у своєму місті' : `до ${option.radiusKm} км`;
  else if (option.region) territory = option.region;
  else if (option.nationwide) territory = 'по всій Україні';
  else if (option.regions) territory = option.regions.join(', ');
  return labels[option.method] + (territory ? ` — ${territory}` : '');
}).join('; ') : 'Умови отримання потрібно уточнити';

export default function DeliveryOptionsFields({ role, value, onChange, ownPlace = false, disabled = false, maxOptions = 4, sourceOptions }: {
  role: 'buyer' | 'seller'; value: DeliveryOption[]; onChange: (next: DeliveryOption[]) => void; ownPlace?: boolean; disabled?: boolean; maxOptions?: number; sourceOptions?: DeliveryOption[];
}) {
  const update = (method: DeliveryMethod, patch: Partial<DeliveryOption>) => onChange(value.map(option => option.method === method ? { ...option, ...patch } : option));
  const selected = (method: DeliveryMethod) => value.find(option => option.method === method);
  const toggle = (method: DeliveryMethod, enabled: boolean) => {
    const initial: DeliveryOption = sourceOptions?.find(option => option.method === method) ?? (method === 'SELF_PICKUP' && role === 'buyer' || method === 'SELLER_DELIVERY' && role === 'seller' ? { method, radiusKm: 0 }
      : method === 'POSTAL_DELIVERY' && role === 'seller' ? { method, nationwide: true } : { method });
    onChange(enabled ? maxOptions === 1 ? [initial] : [...value, initial] : value.filter(option => option.method !== method));
  };
  const addRegion = (method: DeliveryMethod, region: string | null) => {
    if (!region) return;
    const current = selected(method);
    if (!current) return;
    if (method === 'SELF_PICKUP') update(method, { region, radiusKm: undefined });
    else if (!current.regions?.includes(region)) update(method, { regions: [...(current.regions ?? []), region], nationwide: undefined, radiusKm: undefined });
  };
  const place = (method: DeliveryMethod, option: DeliveryOption) => ownPlace && (method === 'SELF_PICKUP' || method === 'SELLER_DELIVERY') ? <div className="delivery-place">
    <SettlementPicker value={null} legacyName={option.place?.settlementCode ? 'Населений пункт вибрано' : ''} label="Місце продавця" onChange={(settlement: Settlement | null) => update(method, { place: { settlementCode: settlement?.code ?? null, region: settlement?.region ?? null, publicPoint: null } })} />
    {(method === 'SELF_PICKUP' || option.radiusKm !== undefined && option.radiusKm > 0) && <><p className="listing-location-note">Оберіть на мапі публічну приблизну точку, від якої рахувати радіус.</p><LocationPointPicker point={option.place?.publicPoint ?? null} onChange={point => update(method, { place: { settlementCode: option.place?.settlementCode ?? null, region: option.place?.region ?? null, publicPoint: { latitude: Number(point.latitude.toFixed(2)), longitude: Number(point.longitude.toFixed(2)) } } })} /></>}
  </div> : null;
  return <fieldset className="listing-section" disabled={disabled}><legend>Способи отримання</legend>
    <p className="listing-location-note">Можна вибрати декілька способів. Точний збіг враховує територію кожного способу.</p>
    {(Object.keys(labels) as DeliveryMethod[]).filter(method => !sourceOptions || sourceOptions.some(option => option.method === method)).map(method => {
      const option = selected(method);
      return <div key={method} className="delivery-option"><label className="subscription-active"><input type="checkbox" checked={Boolean(option)} onChange={event => toggle(method, event.target.checked)} /> {labels[method]}</label>
        {option && method === 'SELF_PICKUP' && role === 'buyer' && <><label>Територія самовивозу<select value={option.region ? 'region' : 'radius'} onChange={event => update(method, event.target.value === 'radius' ? { region: undefined, radiusKm: 0 } : { radiusKm: undefined, region: '' })}><option value="radius">Населений пункт і радіус</option><option value="region">Область</option></select></label>{option.region !== undefined ? <><SettlementPicker value={null} territoryMode label="Оберіть область" onChange={() => {}} onRegionChange={region => addRegion(method, region)} /><span>{option.region || 'Оберіть область'}</span></> : <label>Готовий їхати, км<input type="number" min="0" max="500" step="1" value={option.radiusKm ?? 0} onChange={event => update(method, { radiusKm: Number(event.target.value) })} /></label>}</>}
        {option && method === 'SELLER_DELIVERY' && role === 'seller' && !sourceOptions && <><label>Територія доставки<select value={option.regions ? 'regions' : 'radius'} onChange={event => update(method, event.target.value === 'radius' ? { regions: undefined, radiusKm: 0 } : { radiusKm: undefined, regions: [] })}><option value="radius">Місто і радіус</option><option value="regions">Вибрані області</option></select></label>{option.regions ? <><SettlementPicker value={null} territoryMode label="Додати область" onChange={() => {}} onRegionChange={region => addRegion(method, region)} /><ul>{option.regions.map(region => <li key={region}>{region} <button type="button" onClick={() => update(method, { regions: option.regions?.filter(item => item !== region) })}>×</button></li>)}</ul></> : <label>Радіус доставки, км<input type="number" min="0" max="500" step="1" value={option.radiusKm ?? 0} onChange={event => update(method, { radiusKm: Number(event.target.value) })} /></label>}</>}
        {option && method === 'POSTAL_DELIVERY' && role === 'seller' && !sourceOptions && <><label><input type="radio" checked={Boolean(option.nationwide)} onChange={() => update(method, { nationwide: true, regions: undefined })} /> Уся Україна</label><label><input type="radio" checked={!option.nationwide} onChange={() => update(method, { nationwide: undefined, regions: [] })} /> Вибрані області</label>{!option.nationwide && <><SettlementPicker value={null} territoryMode label="Додати область" onChange={() => {}} onRegionChange={region => addRegion(method, region)} /><ul>{option.regions?.map(region => <li key={region}>{region} <button type="button" onClick={() => update(method, { regions: option.regions?.filter(item => item !== region) })}>×</button></li>)}</ul></>}</>}
        {option && sourceOptions && <p className="listing-location-note">{deliveryOptionsLabel([option])}</p>}{option && !sourceOptions && place(method, option)}
      </div>;
    })}
  </fieldset>;
}
