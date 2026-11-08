import { adminActionLabel, reasonLabels } from './Operations';
import { Alert, Box, useMediaQuery } from '@mui/material';
import { List, Datagrid, TextField, DateField, TextInput, FunctionField, usePermissions, SimpleList, SelectInput, DateInput, TopToolbar, FilterButton, SortButton, useResourceContext } from 'react-admin';
export const resources = [
  { name: 'users', label: 'Користувачі', permission: 'users.read', fields: ['username', 'nickname'], dates: ['createdAt', 'lastSeenAt', 'restrictedUntil'] },
  { name: 'products', label: 'Товари', permission: 'products.read', fields: ['title', 'status', 'hidden', 'categoryId'], dates: ['createdAt'] },
  { name: 'requests', label: 'Запити покупців', permission: 'requests.read', fields: ['title', 'status', 'hidden', 'categoryId'], dates: ['createdAt'] },
  { name: 'offers', label: 'Пропозиції продавців', permission: 'offers.read', fields: ['status', 'requestId'], dates: ['createdAt'] },
  { name: 'deals', label: 'Угоди', permission: 'deals.read', fields: ['status', 'requestId'], dates: ['createdAt'] },
  { name: 'moderation', label: 'Модерація', permission: 'moderation.read', fields: ['targetType', 'targetId', 'reason', 'status'], dates: ['createdAt'] },
  { name: 'audit', label: 'Системні події', permission: 'audit.read', fields: ['actorId', 'action', 'entityType', 'entityId', 'result', 'reason'], dates: ['createdAt'] },
];
export const labels: Record<string, string> = { id: 'Ідентифікатор', username: 'Логін', title: 'Назва', status: 'Статус', categoryId: 'Категорія', requestId: 'Запит', actorId: 'Виконавець', action: 'Операція', entityType: 'Тип об’єкта', entityId: 'Об’єкт', targetType: 'Тип об’єкта', targetId: 'Об’єкт', reason: 'Причина', result: 'Результат', createdAt: 'Створено', lastSeenAt: 'Остання активність', nickname: 'Публічне ім’я', hidden: 'Приховано', restrictedUntil: 'Обмеження до' };
export const values: Record<string, string> = { restricted: 'Обмежено', draft: 'Чернетка', active: 'Активний', paused: 'Призупинено', sold: 'Продано', expired: 'Строк минув', open: 'Відкрито', partially_selected: 'Частково обрано', partially_completed: 'Частково завершено', partially_fulfilled: 'Частково виконано', completed: 'Завершено', fulfilled: 'Виконано', cancelled: 'Скасовано', submitted: 'Надіслано', accepted: 'Прийнято', partially_accepted: 'Частково прийнято', rejected: 'Відхилено', withdrawn: 'Відкликано', selected: 'Обрано', in_progress: 'Виконується', buyer_marked_completed: 'Покупець підтвердив', seller_marked_completed: 'Продавець підтвердив', failed: 'Не виконано', disputed: 'Спір', under_review: 'На розгляді', resolved: 'Розглянуто', dismissed: 'Відхилено', user: 'Користувач', product: 'Товар', buy_request: 'Запит покупця', order: 'Угода', message: 'Повідомлення' };
export function ResourceList({ fields, dates, permission }: { fields: string[]; dates: string[]; permission: string }) {
  const resource = useResourceContext() ?? '';
  const filters = [<TextInput key="q" source="q" label="Пошук за ID або назвою" alwaysOn />, <DateInput key="from" source="from" label="Створено від (UTC)" />, <DateInput key="to" source="to" label="Створено до, не включно (UTC)" />];
  if (['users','products','requests','moderation','offers','deals'].includes(resource)) filters.push(<SelectInput key="status" source="status" label="Статус" choices={(resource === 'users' ? ['active','restricted'] : resource === 'products' ? ['draft','active','paused','sold','expired'] : resource === 'moderation' ? ['open','under_review','resolved','dismissed'] : resource === 'requests' ? ['open','partially_selected','partially_completed','partially_fulfilled','completed','fulfilled','cancelled','expired'] : ['draft','submitted','accepted','selected','in_progress','completed','failed','cancelled']).map(id=>({id,name:values[id] ?? id}))} />);
  if (['products','requests'].includes(resource)) filters.push(...['categoryId','authorId','region'].map(source => <TextInput key={source} source={source} label={({categoryId:'Категорія (UUID)',authorId:'Автор (UUID)',region:'Область'} as Record<string,string>)[source]} />), <SelectInput key="visibility" source="visibility" label="Видимість" choices={[{id:'hidden',name:'Приховано'},{id:'visible',name:'Дозволено'}]} />);
  if (resource === 'users') filters.push(<TextInput key="role" source="role" label="Роль (код)" />, <SelectInput key="activity" source="activity" label="Активність" choices={[{id:'recent',name:'За 30 днів'},{id:'inactive',name:'Понад 30 днів / відсутня'}]} />);
  if (resource === 'moderation') filters.push(<TextInput key="targetType" source="targetType" label="Тип об’єкта (код)" />, <SelectInput key="reason" source="reason" label="Причина" choices={[{id:'category',name:'Неправильна категорія'},{id:'other',name:'Інша причина'}]} />);
  const mobile = useMediaQuery('(max-width:600px)');
  const { permissions, isPending } = usePermissions<string[]>();
  if (isPending) return <p>Завантаження…</p>;
  if (!permissions?.includes(permission)) return <Alert severity="error">Недостатньо прав для цього розділу</Alert>;
  return <List actions={<TopToolbar><FilterButton /><SortButton fields={['createdAt', 'id']} /></TopToolbar>} filterDefaultValues={resource === 'moderation' ? { status: 'open' } : undefined} exporter={false} sort={{ field: 'createdAt', order: 'DESC' }} filters={filters} empty={false}>
    {mobile ? <SimpleList linkType="show"
      primaryText={record => record.title ?? record.username ?? record.id}
      secondaryText={record => <Box component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
        {[...fields, ...dates].map(source => <Box component="span" key={source} sx={{ display: 'block' }}>
          {labels[source]}: {record[source] == null ? '—' : dates.includes(source) ? new Date(record[source]).toLocaleString('uk-UA') : source === 'action' ? adminActionLabel(record[source]) : source === 'reason' ? reasonLabels[record[source]] ?? record[source] : source === 'result' && record[source] === 'success' ? 'Виконано' : source === 'hidden' ? (record[source] ? 'Так' : 'Ні') : values[record[source]] ?? String(record[source])}
        </Box>)}
      </Box>} /> : <Datagrid bulkActionButtons={false} rowClick="show" sx={{ '& td': { maxWidth: 260, overflowWrap: 'anywhere' } }}>
      <TextField source="id" label={labels.id} />
      {fields.map(source => ['status', 'targetType', 'hidden', 'action', 'reason', 'result'].includes(source) ? <FunctionField sortable={false} key={source} label={labels[source]} render={(row: Record<string, string>) => source === 'action' ? adminActionLabel(row[source]) : source === 'reason' ? reasonLabels[row[source]] ?? row[source] : source === 'result' && row[source] === 'success' ? 'Виконано' : source === 'hidden' ? (row[source] ? 'Так' : 'Ні') : values[row[source]] ?? row[source] ?? '—'} /> : <TextField sortable={['username','title'].includes(source)} key={source} source={source} label={labels[source]} emptyText="—" />)}
      {dates.map(source => <DateField sortable={source !== 'restrictedUntil'} key={source} source={source} label={labels[source]} locales="uk-UA" showTime emptyText="—" />)}
    </Datagrid>}
  </List>;
}
