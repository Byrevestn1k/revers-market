import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { DateField, FunctionField, Show, SimpleShowLayout, TextField, usePermissions, useRecordContext, useResourceContext } from 'react-admin';
import { Link } from 'react-router-dom';
import { AdminOperations, reasonLabels, adminActionLabel } from './Operations';
import { resources, labels, values } from './resources';

function Detail() {
  const record = useRecordContext(), resource = useResourceContext() ?? '';
  const { permissions } = usePermissions<string[]>();
  if (!record) return null;
  const targetResource = ({ product: 'products', buy_request: 'requests', user: 'users' } as Record<string,string>)[record.targetType];
  const publicPath = resource === 'products' ? `/products/${record.id}` : resource === 'requests' ? `/buy-requests/${record.id}` : resource === 'users' ? `/profiles/${encodeURIComponent(record.username)}` : null;
  return <Box sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
    {['products','requests'].includes(resource) && <Alert severity={record.hidden ? 'warning' : 'success'}>{record.hidden ? 'Приховано модерацією' : 'Видимість дозволена'} · Комерційний статус: {values[record.status] ?? record.status}</Alert>}
    {resource === 'users' && <Alert severity={record.restrictedUntil && Date.parse(record.restrictedUntil)>Date.now() ? 'warning' : 'info'}>Обмеження до: {record.restrictedUntil ? new Date(record.restrictedUntil).toLocaleString('uk-UA') : 'відсутнє'}</Alert>}
    <Typography sx={{ whiteSpace: 'pre-wrap', my: 2 }}>{record.description ?? record.bio}</Typography>
    {record.counts && <Stack spacing={1} sx={{ my: 2 }}>{Object.entries(record.counts).map(([key,value]) => <Typography key={key}>{({products:'Товари',requests:'Запити',offers:'Пропозиції',deals:'Угоди',reports:'Скарги на користувача'} as Record<string,string>)[key]}: {String(value)}</Typography>)}</Stack>}
    {['products','requests'].includes(resource) && <Stack spacing={1} sx={{ my: 2 }}>
      <Typography>Категорія: {record.categoryName}</Typography>
      <Typography>Кількість: {record.quantity} {record.unit}</Typography>
      <Typography>Ціна / бюджет: {record.price ?? ([record.minPrice,record.maxPrice].filter(v=>v!=null).join(' – ') || 'Не вказано')} {record.currency}</Typography>
      <Typography>Автор: {record.authorId}</Typography>
    </Stack>}
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      {publicPath && <Button component="a" href={publicPath} target="_blank" rel="noopener">Публічна сторінка</Button>}
      {['products','requests','users'].includes(resource) && permissions?.includes('moderation.read') && <Button component={Link} to={`/moderation?filter=${encodeURIComponent(JSON.stringify({targetId:record.id,targetType:resource === 'products' ? 'product' : resource === 'requests' ? 'buy_request' : 'user'}))}`}>Пов’язані скарги</Button>}
      {resource === 'moderation' && targetResource && permissions?.includes(`${targetResource}.read`) && <Button component={Link} to={`/${targetResource}/${record.targetId}/show`}>Перевірити об’єкт і виконати дію</Button>}
    </Stack>
    {resource === 'moderation' && !targetResource && <Alert severity="info">Приватний вміст цього типу об’єкта недоступний в адміністративному інтерфейсі.</Alert>}
    <AdminOperations />
    {record.history && <Box sx={{ my: 2 }}><Typography variant="h6">Історія рішень (останні 100)</Typography>
      {record.history.length === 0 ? <Typography>Рішень поки немає</Typography> : record.history.map((entry: Record<string,string>) => <Box key={entry.id} sx={{ py: 1, borderBottom: '1px solid #ddd' }}>
        <Typography>{new Date(entry.createdAt).toLocaleString('uk-UA')} · {adminActionLabel(entry.action)} · {reasonLabels[entry.reason] ?? entry.reason}</Typography>
        <Typography variant="body2">Рішення: {entry.id} · Виконавець: {entry.actorId ?? 'Оператор'} · {entry.result === 'success' ? 'Виконано' : entry.result}</Typography>
      </Box>)}
    </Box>}
  </Box>;
}
export function ResourceShow() {
  const resource = useResourceContext() ?? '', config = resources.find(r => r.name === resource);
  const { permissions, isPending } = usePermissions<string[]>();
  if (isPending) return <p>Завантаження…</p>;
  if (!config || !permissions?.includes(config.permission)) return <Alert severity="error">Недостатньо прав</Alert>;
  return <Show><SimpleShowLayout><TextField source="id" label="Ідентифікатор" />
    {config.fields.map(field => <FunctionField key={field} label={labels[field] ?? field} render={(row: Record<string, unknown>) => field === 'hidden' ? (row[field] ? 'Так' : 'Ні') : values[String(row[field])] ?? String(row[field] ?? '—')} />)}
    <DateField source="createdAt" label="Створено" locales="uk-UA" showTime /><Detail />
  </SimpleShowLayout></Show>;
}
