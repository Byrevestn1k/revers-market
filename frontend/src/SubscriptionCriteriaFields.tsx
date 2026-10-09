import { useState } from 'react';
import { CURRENCIES, LISTING_UNITS } from './listing-options';
import SettlementPicker from './SettlementPicker';
import { settlementLabel } from './settlement-model';
import { countryName, receiptLabels, type CriteriaDraft, type ReceiptMethod } from './subscription-criteria';

export default function SubscriptionCriteriaFields({ value, onChange }: {
  value: CriteriaDraft; onChange: (value: CriteriaDraft) => void;
}) {
  const [message, setMessage] = useState('');
  const change = (patch: Partial<CriteriaDraft>) => { setMessage(''); onChange({ ...value, ...patch }); };
  return <>
    <div className="subscription-criteria-section"><h3>Географія</h3>
      <p className="subscription-hint">Достатньо країни, області або одного міста. Область і міста з інших областей об’єднуються: підходить збіг із будь-якою вибраною територією.</p>
      <SettlementPicker value={null} territoryMode allowNationwide label="Країна, область або населений пункт" onCountryChange={code => {
        if (value.countryCodes.includes(code)) { setMessage('Цю країну вже вибрано.'); return; }
        if (value.countryCodes.length >= 30) { setMessage('Можна вибрати до 30 країн.'); return; }
        change({ countryCodes: [...value.countryCodes, code], ...(code === 'UA' ? { regions: [], settlements: [], suburbsEnabled: false } : {}) });
      }} onRegionChange={region => {
        if (!region) return;
        if (value.countryCodes.includes('UA')) { setMessage('Уся Україна вже включає цю область.'); return; }
        if (value.regions.includes(region)) { setMessage('Цю область уже вибрано.'); return; }
        if (value.regions.length >= 30) { setMessage('Можна вибрати до 30 областей.'); return; }
        change({ regions: [...value.regions, region], settlements: value.settlements.filter(city => value.suburbsEnabled || city.region !== region) });
      }} onChange={city => {
        if (!city) return;
        if (value.countryCodes.includes('UA')) { setMessage('Уся Україна вже включає цей населений пункт і передмістя.'); return; }
        if (value.settlements.some(item => item.code === city.code)) { setMessage('Цей населений пункт уже вибрано.'); return; }
        if (!value.suburbsEnabled && value.regions.includes(city.region)) { setMessage('Цей населений пункт уже включений у вибрану область.'); return; }
        if (value.settlements.length >= 30) { setMessage('Можна вибрати до 30 населених пунктів.'); return; }
        change({ settlements: [...value.settlements, city] });
      }} />
      <ul className="subscription-cities" aria-label="Вибрані території">
        {value.countryCodes.map(code => <li key={code}><span>{countryName(code)} — усі населені пункти</span><button type="button" className="text-button" aria-label={`Прибрати ${countryName(code)}`} onClick={() => change({ countryCodes: value.countryCodes.filter(item => item !== code) })}>×</button></li>)}
        {value.regions.map(region => <li key={region}><span>{region} — усі населені пункти</span><button type="button" className="text-button" aria-label={`Прибрати ${region}`} onClick={() => change({ regions: value.regions.filter(item => item !== region) })}>×</button></li>)}
        {value.settlements.map(city => <li key={city.code}><span>{settlementLabel(city)}</span><button type="button" className="text-button" aria-label={`Прибрати ${city.name}`} onClick={() => {
          const settlements = value.settlements.filter(item => item.code !== city.code);
          change({ settlements, suburbsEnabled: settlements.length > 0 && value.suburbsEnabled });
        }}>×</button></li>)}
      </ul>
      <p className="subscription-hint">Знайдіть наступну територію в цьому ж полі. Достатньо збігу з будь-якою вибраною територією. Країна або область уже включає всі свої населені пункти.</p>
      {value.countryCodes.includes('UA') && <p className="subscription-hint">Уся Україна вже включає всі її області, населені пункти та передмістя.</p>}
      <label className="subscription-active"><input type="checkbox" disabled={!value.settlements.length} checked={value.suburbsEnabled} onChange={event => change({ suburbsEnabled: event.target.checked, settlements: value.settlements.filter(city => event.target.checked || !value.regions.includes(city.region)) })} /> Враховувати передмістя</label>
      {!value.settlements.length && <p className="subscription-hint">Для передмістя спочатку оберіть місто або населений пункт.</p>}
      {value.suburbsEnabled && <div className="subscription-suburbs">
        <label>Відстань за межами міста: {value.cityOutsideKm} км<input type="range" aria-label="Відстань за межами міста" min="0" max="20" step="1" value={value.cityOutsideKm} onChange={event => change({ cityOutsideKm: event.target.value })} /></label>
        <p className="subscription-hint">До 20 км від адміністративних меж вибраних міст до публічної точки запиту. Саме місто також включене. Якщо межі не підтверджені, збереження запропонує вимкнути передмістя.</p>
      </div>}
    </div>
    <div className="subscription-criteria-section"><h3>Кількість і ціна — необов’язково</h3>
      <p className="subscription-hint">Порожні межі не обмежують кількість або бюджет. «Не обмежувати» означає будь-яку одиницю чи валюту.</p>
      <label>Одиниця<select value={value.unit} onChange={event => change({ unit: event.target.value })}><option value="">Не обмежувати</option>{LISTING_UNITS.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
      <div className="subscription-field-pair"><label>Кількість від<input type="number" min="0.0001" step="0.0001" value={value.minQuantity} onChange={event => change({ minQuantity: event.target.value })} /></label><label>Кількість до<input type="number" min="0.0001" step="0.0001" value={value.maxQuantity} onChange={event => change({ maxQuantity: event.target.value })} /></label></div>
      <div className="subscription-field-pair"><label>Прийнятна ціна від, за одиницю<input type="number" min="0" step="0.0001" value={value.minPrice} onChange={event => change({ minPrice: event.target.value })} /></label><label>Прийнятна ціна до, за одиницю<input type="number" min="0" step="0.0001" value={value.maxPrice} onChange={event => change({ maxPrice: event.target.value })} /></label></div>
      <label>Валюта<select value={value.currency} onChange={event => change({ currency: event.target.value })}><option value="">Не обмежувати</option>{CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <p className="subscription-hint">Числові межі потребують одиниці; ціна також потребує валюти. Кілограми й тонни перераховуються. Валюти не конвертуються. Якщо покупець не вказав бюджет, ціну можна узгодити — такий запит також підходить.</p>
    </div>
    <div className="subscription-criteria-section"><h3>Спосіб отримання</h3><p className="subscription-hint">Оберіть хоча б один варіант. Обидва варіанти не обмежують отримання. «Бажано доставити» підходить і для самовивозу, і для доставки продавцем.</p>
      {(Object.entries(receiptLabels) as [ReceiptMethod, string][]).map(([method, label]) => <label key={method} className="subscription-active"><input type="checkbox" checked={value.receiptMethods.includes(method)} onChange={event => {
        if (!event.target.checked && value.receiptMethods.length === 1) { setMessage('Щонайменше один спосіб отримання має залишатися активним.'); return; }
        change({ receiptMethods: event.target.checked ? [...value.receiptMethods, method] : value.receiptMethods.filter(item => item !== method) });
      }} /> {label}</label>)}
    </div>
    {message && <p className="form-error" role="alert">{message}</p>}
  </>;
}
