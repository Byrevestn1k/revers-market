import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField as Input } from '@mui/material';
import { Confirm, useNotify, usePermissions, useRecordContext, useRefresh, useResourceContext } from 'react-admin';
import { adminRequest } from './api';

// Stable integration point for future contextual controls on the public site.
export const actionRegistry: Record<string, { permission: string; actions: Record<string, string> }> = {
  users: { permission: 'users.restrict', actions: { restrict: 'Тимчасово заблокувати', unrestrict: 'Розблокувати' } },
  products: { permission: 'products.moderate', actions: { hide: 'Приховати', restore: 'Відновити' } },
  requests: { permission: 'requests.moderate', actions: { hide: 'Приховати', restore: 'Відновити' } },
  moderation: { permission: 'moderation.decide', actions: { under_review: 'Взяти на розгляд', resolved: 'Завершити розгляд', dismissed: 'Відхилити скаргу', open: 'Повернути до черги' } },
};
export function adminActionLabel(action: string) {
  const parts = action.split('.');
  return actionRegistry[parts[1]]?.actions[parts[2]] ?? ({ 'admin.grant_created': 'Надано роль', 'admin.grant_revoked': 'Відкликано роль', 'admin.super_admin_bootstrap': 'Контрольоване призначення Super Admin', 'admin.qa_seed': 'Створено локальні тестові дані' } as Record<string,string>)[action] ?? action;
}
export const reasonLabels: Record<string,string> = { policy_violation: 'Порушення правил', spam: 'Спам', fraud_risk: 'Ризик шахрайства', review_completed: 'Перевірку завершено', mistake_corrected: 'Виправлення помилкового рішення', insufficient_evidence: 'Недостатньо доказів' };
export function AdminOperations() {
  const resource = useResourceContext() ?? '';
  const record = useRecordContext();
  const { permissions } = usePermissions<string[]>();
  const config = actionRegistry[resource];
  const [action, setAction] = useState(''), [reason, setReason] = useState(''), [until, setUntil] = useState('');
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const notify = useNotify(), refresh = useRefresh();
  if (!record || !config || !permissions?.includes(config.permission)) return null;
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const payload = { action, reason, version: record.version, ...(action === 'restrict' ? { until: new Date(until).toISOString() } : {}) };
    const signature = JSON.stringify(payload);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    try {
      await adminRequest(`/api/admin/${resource}/${record.id}/actions`, { method: 'POST', body: JSON.stringify({ ...payload, requestKey: pending.current.key }) });
      pending.current = null; setAction(''); setConfirm(false); refresh(); notify('Рішення збережено в журналі', { type: 'success' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Не вдалося зберегти рішення'); setConfirm(false); }
    finally { setBusy(false); }
  };
  return <Box sx={{ my: 2 }}><Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
    {Object.entries(config.actions).map(([key,label]) => <Button key={key} variant="outlined" onClick={() => { setAction(key); setReason(''); setError(''); }}>
      {label}
    </Button>)}
  </Stack>
    <Dialog fullWidth maxWidth="sm" open={Boolean(action)} onClose={() => { if (!busy) setAction(''); }}>
      <DialogTitle>{config.actions[action]}</DialogTitle><DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">Рішення буде записано в журнал. Причина обов’язкова. Для оскарження можна посилатися на запис рішення.</Alert>
          <Input select label="Причина рішення" required value={reason} onChange={e => setReason(e.target.value)}>
            {Object.entries(reasonLabels).map(([id,label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
          </Input>
          {action === 'restrict' && <Input label="До (місцевий час, до 30 днів)" type="datetime-local" required value={until} onChange={e => setUntil(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent><DialogActions><Button disabled={busy} onClick={() => setAction('')}>Скасувати</Button><Button disabled={busy || !reason || (action === 'restrict' && (!until || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now() || Date.parse(until) > Date.now()+30*86400000))} onClick={() => setConfirm(true)}>Перевірити рішення</Button></DialogActions>
    </Dialog>
    <Confirm isOpen={confirm} loading={busy} title="Підтвердити адміністративну дію" content={`${config.actions[action]}: ${record.title ?? record.username ?? record.id}. Причина: ${reasonLabels[reason] ?? ''}.`} onConfirm={submit} onClose={() => { if (!busy) setConfirm(false); }} confirm="Підтвердити" cancel="Скасувати" />
  </Box>;
}
