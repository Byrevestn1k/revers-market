import { useState } from 'react';
import { COUNTRIES } from './countries';
import { CURRENCIES, LISTING_UNITS } from './listing-options';
import SettlementPicker from './SettlementPicker';
import LocationPointPicker from './LocationPointPicker';
import { resolveSettlement, settlementLabel } from './settlement-model';
import { criteriaPayload, receiptLabels, type CriteriaDraft, type ReceiptMethod } from './subscription-criteria';

export default function SubscriptionCriteriaFields({ value, regions, onChange, onBusy }: {
  value: CriteriaDraft; regions: string[]; onChange: (value: CriteriaDraft) => void; onBusy: (busy: boolean) => void;
}) {
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const point = criteriaPayload(value).center;
  const change = (patch: Partial<CriteriaDraft>) => { setMessage(''); onChange({ ...value, ...patch }); };
  const useCityCenter = async () => {
    if (!value.settlements[0]) return;
    setLocating(true); onBusy(true); setMessage('');
    try {
      const city = await resolveSettlement(value.settlements[0]);
      if (city.coordinates) change({ centerLatitude: String(city.coordinates.latitude), centerLongitude: String(city.coordinates.longitude) });
    } catch (caught) { setMessage((caught as Error).message); }
    finally { setLocating(false); onBusy(false); }
  };
  return <>
    <div className="subscription-criteria-section"><h3>Географія</h3><p className="subscription-hint">Оберіть країну, область або хоча б одне місто. Область, міста й радіус звужують вибрану територію.</p>
      <label>Країна<select value={value.countryCode} onChange={event => change({ countryCode: event.target.value, region: '', settlements: [] })}><option value="">Країна не обмежена</option>{COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
      {(!value.countryCode || value.countryCode === 'UA') && <>
        <label>Область<select value={value.region} onChange={event => change({ region: event.target.value, settlements: value.settlements.filter(city => !event.target.value || city.region === event.target.value) })}><option value="">Будь-яка область</option>{regions.map(region => <option key={region}>{region}</option>)}</select></label>
        <SettlementPicker value={null} label="Додати місто / населений пункт" disabled={value.settlements.length >= 30 || locating} onChange={city => {
          if (!city) return;
          if (value.region && city.region !== value.region) { setMessage('Це місто не входить у вибрану область. Змініть область або оберіть інше місто.'); return; }
          if (!value.settlements.some(item => item.code === city.code)) change({ settlements: [...value.settlements, city] });
        }} />
        <ul className="subscription-cities" aria-label="Вибрані міста">{value.settlements.map(city => <li key={city.code}><span title={settlementLabel(city)}>{settlementLabel(city)}</span><button type="button" className="text-button" aria-label={`Прибрати ${city.name}`} onClick={() => change({ settlements: value.settlements.filter(item => item.code !== city.code) })}>×</button></li>)}</ul>
        <p className="subscription-hint">Міста перевіряються за довідником України. Можна обрати до 30; достатньо збігу з одним із них.</p>
      </>}
      <label className="subscription-active"><input type="checkbox" checked={value.radiusEnabled} onChange={event => change({ radiusEnabled: event.target.checked })} /> Обмежити радіусом від точки</label>
      {value.radiusEnabled && <div className="subscription-radius">
        <label>Радіус, км<input type="number" min="0.2" max="200" step="0.1" value={value.radiusKm} required onChange={event => change({ radiusKm: event.target.value })} /></label>
        <p className="subscription-hint">Оберіть точку на мапі, вкажіть координати або використайте центр першого вибраного міста. Відстань перевіряється до публічної, іноді приблизної точки запиту.</p>
        {value.settlements.length > 0 && <button type="button" className="outline-button" disabled={locating} onClick={() => void useCityCenter()}>{locating ? 'Визначаємо центр…' : `Центр міста ${value.settlements[0].name}`}</button>}
        <div className="subscription-field-pair"><label>Широта<input type="number" min="-90" max="90" step="any" value={value.centerLatitude} required onChange={event => change({ centerLatitude: event.target.value })} /></label><label>Довгота<input type="number" min="-180" max="180" step="any" value={value.centerLongitude} required onChange={event => change({ centerLongitude: event.target.value })} /></label></div>
        <LocationPointPicker point={point} onChange={next => change({ centerLatitude: String(next.latitude), centerLongitude: String(next.longitude) })} />
      </div>}
    </div>
    <div className="subscription-criteria-section"><h3>Кількість і ціна — необов’язково</h3>
      <p className="subscription-hint">Залиште поля порожніми, якщо обсяг чи бюджет неважливі. Для обмеження кількості або ціни оберіть одиницю; для ціни також валюту.</p>
      <label>Одиниця<select value={value.unit} onChange={event => change({ unit: event.target.value })}><option value="">Не обмежувати</option>{LISTING_UNITS.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
      <div className="subscription-field-pair"><label>Кількість від<input type="number" min="0.0001" step="0.0001" value={value.minQuantity} onChange={event => change({ minQuantity: event.target.value })} /></label><label>Кількість до<input type="number" min="0.0001" step="0.0001" value={value.maxQuantity} onChange={event => change({ maxQuantity: event.target.value })} /></label></div>
      <div className="subscription-field-pair"><label>Прийнятна ціна від, за одиницю<input type="number" min="0" step="0.0001" value={value.minPrice} onChange={event => change({ minPrice: event.target.value })} /></label><label>Прийнятна ціна до, за одиницю<input type="number" min="0" step="0.0001" value={value.maxPrice} onChange={event => change({ maxPrice: event.target.value })} /></label></div>
      <label>Валюта<select value={value.currency} onChange={event => change({ currency: event.target.value })}><option value="">Не обмежувати</option>{CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <p className="subscription-hint">За заданих обмежень запит без кількості або без бюджету не підходить. Кілограми й тонни перераховуються; інші одиниці мають збігатися. Валюти не перераховуються.</p>
    </div>
    <div className="subscription-criteria-section"><h3>Спосіб отримання — необов’язково</h3><p className="subscription-hint">Без вибору спосіб отримання не обмежується. Якщо обрати спосіб, запит має явно дозволяти його.</p>
      {(Object.entries(receiptLabels) as [ReceiptMethod, string][]).map(([method, label]) => <label key={method} className="subscription-active"><input type="checkbox" checked={value.receiptMethods.includes(method)} onChange={event => change({ receiptMethods: event.target.checked ? [...value.receiptMethods, method] : value.receiptMethods.filter(item => item !== method) })} /> {label}</label>)}
    </div>
    {message && <p className="form-error" role="alert">{message}</p>}
  </>;
}
