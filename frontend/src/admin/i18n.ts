import polyglotI18nProvider from 'ra-i18n-polyglot';
import englishMessages from 'ra-language-english';
const messages = {
  resources: Object.fromEntries(['users','products','requests','offers','deals','moderation','audit'].map(name=>[name,{fields:{createdAt:'Створено',id:'Ідентифікатор'}}])),
  ra: {
    action: { add_filter: 'Додати фільтр', remove_filter: 'Прибрати фільтр', remove_all_filters: 'Прибрати фільтри', search: 'Пошук', refresh: 'Оновити', list: 'Список', sort: 'Сортувати', export: 'Експорт', show: 'Переглянути', edit: 'Редагувати', save: 'Зберегти', cancel: 'Скасувати', confirm: 'Підтвердити', close: 'Закрити', back: 'Назад', open_menu: 'Відкрити меню', close_menu: 'Закрити меню', expand: 'Розгорнути', clear_input_value: 'Очистити', skip_nav: 'Перейти до вмісту' },
    navigation: { no_results: 'Результатів немає', no_filtered_results: 'За цими фільтрами нічого не знайдено', clear_filters: 'Очистити фільтри', page_out_of_boundaries: 'Сторінка недоступна', page_out_from_end: 'Кінець списку', page_out_from_begin: 'Початок списку', page_range_info: '%{offsetBegin}–%{offsetEnd} із %{total}', partial_page_range_info: '%{offsetBegin}–%{offsetEnd}', page_rows_per_page: 'Рядків на сторінці:', next: 'Далі', prev: 'Назад', first: 'Перша', last: 'Остання', current_page: 'Сторінка %{page}', page: 'Сторінка %{page}', skip_nav: 'Перейти до вмісту' },
    auth: { auth_check_error: 'Доступ не підтверджено', user_menu: 'Обліковий запис', username: 'Логін або email', password: 'Пароль', sign_in: 'Увійти', sign_in_error: 'Помилка входу', logout: 'Вийти' },
    page: { dashboard: 'Головна панель', list: '%{name}', empty: 'Даних поки немає', error: 'Помилка', not_found: 'Сторінку не знайдено', loading: 'Завантаження' },
    message: { loading: 'Завантаження…', error: 'Не вдалося завантажити дані', not_found: 'Перевірте адресу сторінки' },
    notification: { http_error: 'Помилка запиту', data_provider_error: 'Помилка отримання даних', logged_out: 'Увійдіть повторно' },
    sort: { ASC: 'За зростанням', DESC: 'За спаданням', sort_by: 'Сортувати за %{field} %{order}' },
    validation: { required: 'Обов’язкове поле' },
  },
};
const translated = { ...englishMessages, resources: messages.resources, ra: { ...englishMessages.ra, ...Object.fromEntries(Object.entries(messages.ra).map(([key, value]) => [key, { ...englishMessages.ra[key as keyof typeof englishMessages.ra], ...value }])) } };
export const i18nProvider = polyglotI18nProvider(() => translated, 'uk', { allowMissing: true });
