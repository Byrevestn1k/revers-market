import { Alert, Box, useMediaQuery } from '@mui/material';
import { List, Datagrid, TextField, DateField, TextInput, FunctionField, usePermissions, SimpleList } from 'react-admin';
export const resources = [
  { name: 'users', label: 'Користувачі', permission: 'users.read', fields: ['username'], dates: ['createdAt', 'lastSeenAt'] },
  { name: 'products', label: 'Товари', permission: 'products.read', fields: ['title', 'status', 'categoryId'], dates: ['createdAt'] },
  { name: 'requests', label: 'Запити покупців', permission: 'requests.read', fields: ['title', 'status', 'categoryId'], dates: ['createdAt'] },
  { name: 'offers', label: 'Пропозиції продавців', permission: 'offers.read', fields: ['status', 'requestId'], dates: ['createdAt'] },
  { name: 'deals', label: 'Угоди', permission: 'deals.read', fields: ['status', 'requestId'], dates: ['createdAt'] },
  { name: 'moderation', label: 'Модерація', permission: 'moderation.read', fields: ['targetType', 'targetId', 'reason', 'status'], dates: ['createdAt'] },
  { name: 'audit', label: 'Системні події', permission: 'audit.read', fields: ['actorId', 'action', 'entityType', 'entityId', 'result', 'reason'], dates: ['createdAt'] },
];
const labels: Record<string, string> = { id: 'Ідентифікатор', username: 'Логін', title: 'Назва', status: 'Статус', categoryId: 'Категорія', requestId: 'Запит', actorId: 'Виконавець', action: 'Операція', entityType: 'Тип об’єкта', entityId: 'Об’єкт', targetType: 'Тип об’єкта', targetId: 'Об’єкт', reason: 'Причина', result: 'Результат', createdAt: 'Створено', lastSeenAt: 'Остання активність' };
const values: Record<string, string> = { draft: 'Чернетка', active: 'Активний', paused: 'Призупинено', sold: 'Продано', expired: 'Строк минув', open: 'Відкрито', partially_selected: 'Частково обрано', partially_completed: 'Частково завершено', partially_fulfilled: 'Частково виконано', completed: 'Завершено', fulfilled: 'Виконано', cancelled: 'Скасовано', submitted: 'Надіслано', accepted: 'Прийнято', partially_accepted: 'Частково прийнято', rejected: 'Відхилено', withdrawn: 'Відкликано', selected: 'Обрано', in_progress: 'Виконується', buyer_marked_completed: 'Покупець підтвердив', seller_marked_completed: 'Продавець підтвердив', failed: 'Не виконано', disputed: 'Спір', under_review: 'На розгляді', resolved: 'Розглянуто', dismissed: 'Відхилено', user: 'Користувач', product: 'Товар', buy_request: 'Запит покупця', order: 'Угода', message: 'Повідомлення' };
export function ResourceList({ fields, dates, permission }: { fields: string[]; dates: string[]; permission: string }) {
  const mobile = useMediaQuery('(max-width:600px)');
  const { permissions, isPending } = usePermissions<string[]>();
  if (isPending) return <p>Завантаження…</p>;
  if (!permissions?.includes(permission)) return <Alert severity="error">Недостатньо прав для цього розділу</Alert>;
  return <List exporter={false} sort={{ field: 'createdAt', order: 'DESC' }} filters={[<TextInput key="q" source="q" label="Пошук" alwaysOn />]} empty={false}>
    {mobile ? <SimpleList linkType={false}
      primaryText={record => record.title ?? record.username ?? record.id}
      secondaryText={record => <Box component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
        {[...fields, ...dates].map(source => <Box component="span" key={source} sx={{ display: 'block' }}>
          {labels[source]}: {record[source] == null ? '—' : dates.includes(source) ? new Date(record[source]).toLocaleString('uk-UA') : values[record[source]] ?? String(record[source])}
        </Box>)}
      </Box>} /> : <Datagrid bulkActionButtons={false} rowClick={false} sx={{ '& td': { maxWidth: 260, overflowWrap: 'anywhere' } }}>
      <TextField sortable={false} source="id" label={labels.id} />
      {fields.map(source => ['status', 'targetType'].includes(source) ? <FunctionField sortable={false} key={source} label={labels[source]} render={(row: Record<string, string>) => values[row[source]] ?? row[source] ?? '—'} /> : <TextField sortable={false} key={source} source={source} label={labels[source]} emptyText="—" />)}
      {dates.map(source => <DateField sortable={false} key={source} source={source} label={labels[source]} locales="uk-UA" showTime emptyText="—" />)}
    </Datagrid>}
  </List>;
}
