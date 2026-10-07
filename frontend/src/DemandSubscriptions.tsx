import { useEffect, useState, type FormEvent } from 'react';
import CategoryPicker from './CategoryPicker';
import { categoryLabel, type Category } from './categories';
import { ConfirmationDialog } from './DealInteraction';
import './demand-subscriptions.css';
import SubscriptionCriteriaFields from './SubscriptionCriteriaFields';
import { countryName, criteriaDraft, criteriaPayload, emptyCriteria, receiptLabels, type CriteriaDraft, type SubscriptionCriteria } from './subscription-criteria';
import { unitLabel } from './listing-options';

type Subscription = Partial<SubscriptionCriteria> & { id: string; category: { id: string; name: string }; region: string | null; active: boolean };
type Http = (path: string, options?: RequestInit) => Promise<unknown>;
type Props = { categories: Category[]; http: Http; notify: (message: string) => void };
type Draft = CriteriaDraft & { id?: string; categoryId: string; active: boolean };
const emptyDraft = (): Draft => ({ ...emptyCriteria(), categoryId: '', active: true });

export default function DemandSubscriptions({ categories, http, notify }: Props) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Subscription | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [list, areas] = await Promise.all([http('/api/demand-subscriptions'), http('/api/settlements?mode=regions')]);
      setSubscriptions((list as { subscriptions: Subscription[] }).subscriptions);
      setRegions((areas as { regions: string[] }).regions);
    } catch (caught) { setLoadError((caught as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const mutate = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (!draft.categoryId) { setError('Оберіть категорію або підкатегорію.'); return; }
    if (locationBusy) return;
    if (!draft.countryCode && !draft.region && !draft.settlements.length) { setError('Оберіть країну, область або місто.'); return; }
    if ((draft.minQuantity !== '' || draft.maxQuantity !== '' || draft.minPrice !== '' || draft.maxPrice !== '') && !draft.unit) { setError('Оберіть одиницю кількості та ціни.'); return; }
    if ((draft.minPrice !== '' || draft.maxPrice !== '') && !draft.currency) { setError('Оберіть валюту ціни.'); return; }
    void mutate(async () => {
      const result = await http(draft.id ? `/api/demand-subscriptions/${draft.id}` : '/api/demand-subscriptions', {
        method: draft.id ? 'PATCH' : 'POST',
        body: JSON.stringify({ categoryId: draft.categoryId, ...criteriaPayload(draft), active: draft.active }),
      }) as { subscription: Subscription };
      setSubscriptions(current => draft.id ? current.map(item => item.id === draft.id ? result.subscription : item) : [result.subscription, ...current]);
      setDraft(null);
      notify('Підписку збережено');
    });
  };
  const toggle = (item: Subscription) => void mutate(async () => {
    const result = await http(`/api/demand-subscriptions/${item.id}`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) }) as { subscription: Subscription };
    setSubscriptions(current => current.map(row => row.id === item.id ? result.subscription : row));
    notify(item.active ? 'Підписку вимкнено' : 'Підписку увімкнено');
  });
  const remove = () => void mutate(async () => {
    if (!deleting) return;
    await http(`/api/demand-subscriptions/${deleting.id}`, { method: 'DELETE' });
    setSubscriptions(current => current.filter(item => item.id !== deleting.id));
    setDeleting(null);
    notify('Підписку видалено');
  });

  return <section className="content demand-subscriptions">
    <div className="view-header"><div><span className="eyebrow">Налаштування · Продаю</span><h1>Підписки на запити</h1></div>
      <button className="primary-button" disabled={loading || Boolean(loadError) || busy || Boolean(draft)} onClick={() => { setError(''); setDraft(emptyDraft()); }}>Додати підписку</button>
    </div>
    <p className="subscription-intro">Отримуйте сповіщення про нові запити покупців у вибраній категорії та її підкатегоріях.</p>
    {loading ? <p role="status">Завантажуємо підписки…</p> : loadError ? <div className="empty-state" role="alert"><h2>Не вдалося завантажити підписки</h2><p>{loadError}</p><button className="outline-button" onClick={() => void load()}>Повторити</button></div> : <>
      {error && !deleting && <p className="form-error" role="alert">{error}</p>}
      {draft && <form className="subscription-form" onSubmit={save} aria-label={draft.id ? 'Редагування підписки' : 'Нова підписка'}>
        <h2>{draft.id ? 'Редагування підписки' : 'Нова підписка'}</h2>
        <fieldset disabled={busy || locationBusy}>
          <CategoryPicker categories={categories} value={draft.categoryId} onChange={categoryId => { setDraft({ ...draft, categoryId }); setError(''); }} label="Категорія або підкатегорія" inlineTree />
          <SubscriptionCriteriaFields value={draft} regions={regions} onBusy={setLocationBusy} onChange={criteria => { setDraft({ ...draft, ...criteria }); setError(''); }} />
          <label className="subscription-active"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} /> Активна підписка</label>
          <div className="subscription-actions"><button className="primary-button" disabled={!categories.length}>{busy ? 'Збереження…' : 'Зберегти підписку'}</button><button type="button" className="outline-button" onClick={() => { setDraft(null); setError(''); }}>Скасувати</button></div>
        </fieldset>
      </form>}
      {!subscriptions.length ? <div className="empty-state"><h2>У вас ще немає підписок</h2><p>Оберіть категорію та країну, область або місто, щоб дізнаватися про нові запити.</p></div> : <div className="subscription-list">{subscriptions.map(item => <article key={item.id} className="subscription-card" aria-label={`Підписка: ${item.category.name}`}>
        <div className="subscription-summary"><h2>{categoryLabel(categories, item.category.id) || item.category.name}</h2><p>Локація: {item.region || (item.countryCode === 'UA' || !item.countryCode ? 'Уся Україна' : countryName(item.countryCode))}</p>
          {!!item.settlements?.length && <p>Міста: {item.settlements.map(city => `${city.name} (${city.region})`).join(', ')}</p>}
          {item.radiusKm != null && <p>Радіус: {item.radiusKm} км · точка {item.center?.latitude}, {item.center?.longitude}</p>}
          {(item.minQuantity != null || item.maxQuantity != null) && <p>Кількість: {item.minQuantity ?? 'без мінімуму'} — {item.maxQuantity ?? 'без максимуму'} {unitLabel(item.unit ?? undefined)}</p>}
          {(item.minPrice != null || item.maxPrice != null) && <p>Ціна: {item.minPrice ?? 'без мінімуму'} — {item.maxPrice ?? 'без максимуму'} {item.currency} / {unitLabel(item.unit ?? undefined)}</p>}
          {item.unit && item.minQuantity == null && item.maxQuantity == null && item.minPrice == null && item.maxPrice == null && <p>Одиниця: {unitLabel(item.unit)}</p>}
          {item.currency && item.minPrice == null && item.maxPrice == null && <p>Валюта: {item.currency}</p>}
          {!!item.receiptMethods?.length && <p>{item.receiptMethods.map(method => receiptLabels[method]).join('; ')}</p>}
          <span className={`subscription-status ${item.active ? 'is-active' : ''}`}>Статус: {item.active ? 'Активна' : 'Вимкнена'}</span></div>
        <div className="subscription-actions"><button className="outline-button" disabled={busy || Boolean(draft)} onClick={() => { setError(''); setDraft({ ...criteriaDraft(item), id: item.id, categoryId: item.category.id, active: item.active }); }}>Редагувати</button><button className="outline-button" disabled={busy || Boolean(draft)} onClick={() => toggle(item)}>{item.active ? 'Вимкнути' : 'Увімкнути'}</button><button className="text-button" disabled={busy || Boolean(draft)} onClick={() => { setError(''); setDeleting(item); }}>Видалити</button></div>
      </article>)}</div>}
    </>}
    {deleting && <ConfirmationDialog title="Видалити підписку?" confirmLabel="Видалити" destructive busy={busy} onClose={() => { setDeleting(null); setError(''); }} onConfirm={remove}><p>{deleting.category.name} · {deleting.region || countryName(deleting.countryCode || 'UA')}</p><p>Нові сповіщення за цією підпискою більше не надходитимуть.</p>{error && <p className="form-error" role="alert">{error}</p>}</ConfirmationDialog>}
  </section>;
}
