import { useEffect, useState } from 'react';
import { Title, usePermissions } from 'react-admin';
import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { adminRequest } from './api';
type Role = { id: string; label: string; permissions: string[] };
type Grant = { id: string; userId: string; roleId: string; createdAt: string; expiresAt: string | null };
const reasons = { access_assignment: 'Призначення доступу', access_review: 'Перегляд доступу', incident_response: 'Реагування на інцидент' };
export function Roles() {
  const { permissions } = usePermissions<string[]>();
  const canManage = permissions?.includes('roles.manage');
  const [roles, setRoles] = useState<Role[]>([]);
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [reason, setReason] = useState('access_assignment');
  const [expiresAt, setExpiresAt] = useState('');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!permissions?.includes('roles.read')) return; adminRequest<{ data: Role[] }>('/api/admin/roles').then(result => setRoles(result.data)).catch(e => setError(e.message)); }, [permissions]);
  async function loadGrants() {
    setError(''); setGrants([]);
    try { const result = await adminRequest<{ data: Grant[] }>(`/api/admin/grants?${new URLSearchParams({ userId })}`); setGrants(result.data); }
    catch (e) { setError((e as Error).message); }
  }
  async function mutate(path: string, method: string, body: object) {
    if (!window.confirm('Підтвердити зміну адміністративного доступу?')) return;
    setBusy(true); setMessage(''); setError('');
    try { await adminRequest(path, { method, body: JSON.stringify(body) }); setMessage('Зміну збережено сервером.'); await loadGrants(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!permissions?.includes('roles.read')) return <Alert severity="error">Недостатньо прав для цього розділу</Alert>;
  return <Box sx={{ py: 2 }}><Title title="Ролі й дозволи" /><Typography variant="h4" gutterBottom>Ролі й дозволи</Typography>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 2 }}>{roles.map(role => <Card key={role.id}><CardContent><Typography variant="h6">{role.label}</Typography><Typography component="p" sx={{ overflowWrap: 'anywhere' }}>{role.permissions.join(' · ')}</Typography></CardContent></Card>)}</Box>
    {canManage && <Card sx={{ mt: 2 }}><CardContent><Typography variant="h6">Доступ користувача</Typography><Typography variant="body2">Для зміни потрібен вхід протягом останньої години. Власні права та Super Admin через цей інтерфейс не змінюються.</Typography>
      <Box component="form" onSubmit={e => { e.preventDefault(); void loadGrants(); }} sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', my: 2 }}><TextField label="UUID користувача" value={userId} onChange={e => { setUserId(e.target.value); setGrants([]); }} required sx={{ minWidth: 240, flexGrow: 1 }} /><Button type="submit">Перевірити доступ</Button></Box>
      <Box component="form" onSubmit={e => { e.preventDefault(); void mutate('/api/admin/grants', 'POST', { userId, roleId, reason, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) }); }} sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', my: 2 }}>
        <TextField select label="Роль" value={roleId} required onChange={e => setRoleId(e.target.value)} sx={{ minWidth: 180 }}>{roles.filter(role => role.id !== 'super_admin').map(role => <MenuItem key={role.id} value={role.id}>{role.label}</MenuItem>)}</TextField>
        <TextField select label="Причина" value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(reasons).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}</TextField>
        <TextField label="Діє до (необов’язково)" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <Button type="submit" variant="contained" disabled={busy || !userId}>Призначити роль</Button>
      </Box>
      {grants.map(grant => <Box key={grant.id} sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', my: 1 }}><Typography>{roles.find(r => r.id === grant.roleId)?.label ?? grant.roleId} · {grant.expiresAt ? new Date(grant.expiresAt).toLocaleString('uk-UA') : 'Без строку'}</Typography><Button color="error" disabled={busy || grant.roleId === 'super_admin'} onClick={() => void mutate(`/api/admin/grants/${grant.id}`, 'DELETE', { reason })}>Відкликати</Button></Box>)}
    </CardContent></Card>}
  </Box>;
}
