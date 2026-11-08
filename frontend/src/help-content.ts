export type HelpArticle = { category: string; question: string; answer: string; path: string; link: string; context: string[] }

// Curated product documentation. No user data or generated responses are used here.
export const helpArticles: HelpArticle[] = [
    { category: 'Як працює «ДещоТреба»', question: 'Як тут купувати і продавати?', answer: 'Шукайте товари на мапі або створіть запит: продавці можуть надіслати свої пропозиції. Продавець також може опублікувати товар і переглядати запити покупців.', path: '/discover', link: 'Відкрити пошук', context: ['/discover', '/dashboard'] },
    { category: 'Товари та запити', question: 'Як створити товар або запит?', answer: 'У кабінеті виберіть «Додати оголошення» або «Подати запит». Заповніть назву, категорію, кількість, місце та спосіб отримання. Перевірте дані перед публікацією.', path: '/my/requests/new', link: 'Створити запит', context: ['/my/products/new', '/my/requests/new'] },
    { category: 'Товари та запити', question: 'Як вибрати категорію і характеристики?', answer: 'У формі відкрийте «Категорія та підкатегорія» та виберіть відповідний розділ. Доступні характеристики залежать від категорії. Рекомендація категорії не замінює ваш вибір.', path: '/my/products/new', link: 'Відкрити форму товару', context: ['/my/products/new', '/my/requests/new'] },
    { category: 'Пропозиції продавців', question: 'Як переглянути та обрати пропозицію?', answer: 'У «Мої запити» відкрийте пропозиції до свого запиту. Порівняйте ціну, кількість і доставку. Кнопка «Обрати пропозицію» відкриває підтвердження; після вибору очікується підтвердження продавця.', path: '/my/requests', link: 'Мої запити', context: ['/my/requests'] },
    { category: 'Пропозиції продавців', question: 'Як відповісти на запит покупця?', answer: 'Знайдіть запит, відкрийте його і скористайтеся дією для пропозиції. Перевірте товар, кількість, ціну та умови перед надсиланням.', path: '/requests', link: 'Переглянути запити', context: ['/requests', '/buy-requests'] },
    { category: 'Карта, пошук і фільтри', question: 'Як знайти товари або запити на мапі?', answer: 'На сторінці пошуку введіть назву або оберіть категорію, місце та фільтри. Переміщуйте і наближайте мапу; натисніть позначку або групу, щоб переглянути результати.', path: '/discover', link: 'Відкрити мапу', context: ['/discover', '/map'] },
    { category: 'Карта, пошук і фільтри', question: 'Як отримувати сповіщення про нові запити?', answer: 'У «Підписки на запити» додайте підписку, виберіть категорію та територію і за потреби уточніть інші умови. Збережіть та залиште її активною.', path: '/settings/demand-subscriptions', link: 'Підписки на запити', context: ['/settings/demand-subscriptions'] },
    { category: 'Доставка', question: 'Як узгодити отримання товару?', answer: 'У товарі, запиті та пропозиції можна вказати доступні способи передачі. Уважно перевірте територію та остаточні умови з іншою стороною.', path: '/discover', link: 'Знайти товар', context: ['/my/products/new', '/my/requests/new'] },
    { category: 'Чати й угоди', question: 'Де обговорити та завершити угоду?', answer: 'Для розмови відкрийте «Чати» або кнопку повідомлення на сторінці оголошення. Домовленості та їхній стан доступні в «Мої угоди»; доступні дії залежать від стану угоди.', path: '/messages', link: 'Відкрити чати', context: ['/messages', '/orders'] },
    { category: 'Рейтинги та відгуки', question: 'Де побачити відгуки?', answer: 'Відгуки та рейтинг показані у профілі користувача. Відгуки щодо угоди пов’язані з її завершенням.', path: '/settings/profile', link: 'Мій профіль', context: ['/profiles', '/orders'] },
    { category: 'Сповіщення', question: 'Де знайти сповіщення?', answer: 'Натисніть дзвіночок у шапці. Там можна переглянути події та позначити їх прочитаними. Сповіщення на пристрої вмикаються окремо за вашою згодою.', path: '/notifications', link: 'Сповіщення', context: ['/notifications'] },
    { category: 'Встановлення PWA', question: 'Як встановити застосунок?', answer: 'У кабінеті або меню на головній сторінці виберіть «Встановити застосунок». Якщо браузер не пропонує встановлення автоматично, скористайтеся його меню додавання на головний екран.', path: '/cabinet', link: 'Відкрити кабінет', context: ['/cabinet'] },
    { category: 'Безпека та приватність', question: 'Як захистити свої дані?', answer: 'Не повідомляйте нікому паролі та коди підтвердження. Перед публікацією перевіряйте налаштування видимості адреси та умови, якими ви ділитеся.', path: '/settings/profile', link: 'Налаштування профілю', context: ['/settings/profile'] },
]

export type GuideStep = { text: string; selector?: string; conditional?: boolean }
export function guideForPath(path: string): GuideStep[] {
    if (path.startsWith('/my/products/new') || /^\/my\/products\/[^/]+\/edit$/.test(path)) return [
        { text: 'Назва, опис і фото допоможуть покупцю зрозуміти, що ви продаєте.', selector: '[data-guide="listing-basics"]' },
        { text: 'Категорія допомагає знайти товар. Оберіть підкатегорію та заповніть доступні характеристики.', selector: '.listing-field' },
        { text: 'Характеристики уточнюють товар у вибраній категорії. Заповніть ті значення, які знаєте.', selector: '[data-guide="category-attributes"]', conditional: true },
        { text: 'Кількість показує доступний обсяг; ціну вкажіть за одну вибрану одиницю.', selector: '[data-guide="listing-quantity"]' },
        { text: 'Публічна точка показує товар на мапі та допомагає покупцям знайти його поруч. Перевірте видимість адреси.', selector: '[data-guide="listing-location"]' },
        { text: 'Виберіть способи отримання. Самовивіз означає, що покупець забирає товар; «Можна домовитися» залишає спосіб для узгодження.', selector: '[data-guide="delivery-options"]' },
        { text: 'Доставка продавцем означає, що ви доставляєте товар. Після вибору вкажіть радіус або області доставки.', selector: '[data-guide="delivery-SELLER_DELIVERY"]' },
        { text: 'Тут визначте, куди саме ви доставляєте: місто й радіус або вибрані області.', selector: '[data-guide="delivery-SELLER_DELIVERY"] select', conditional: true },
        { text: 'Для поштової доставки виберіть територію та оператора. Ці поля з’являються після вибору способу.', selector: '[data-guide="delivery-POSTAL_DELIVERY"]' },
        { text: 'Оберіть потрібного поштового оператора, щоб покупець бачив сумісні умови.', selector: '[data-guide="delivery-POSTAL_DELIVERY"] .postal-operators', conditional: true },
        { text: path.startsWith('/my/products/new') ? 'Чернетка зберігається для вас; опублікований товар можуть знайти покупці. Після публікації керуйте ним у «Мої оголошення».' : 'Збережіть зміни. У «Мої оголошення» можна редагувати, призупинити або відновити товар.', selector: '[data-guide="listing-publish"]' },
    ]
    if (path.startsWith('/my/requests/new')) return [
        { text: 'Запит повідомляє продавцям, що саме ви хочете купити. Назва й опис допомагають зрозуміти потребу.', selector: '[data-guide="listing-basics"]' },
        { text: 'Категорія та характеристики допомагають продавцям знайти відповідний запит.', selector: '.listing-field' },
        { text: 'Характеристики уточнюють потребу. Заповніть відомі значення для вибраної категорії.', selector: '[data-guide="category-attributes"]', conditional: true },
        { text: 'Вкажіть потрібну кількість. Бюджет необов’язковий: ціну можна узгодити з продавцем.', selector: '[data-guide="listing-quantity"]' },
        { text: 'Місце запиту допомагає продавцям побачити попит поруч. Точну адресу можна залишити приватною.', selector: '[data-guide="listing-location"]' },
        { text: 'Оберіть прийнятні способи отримання; у «Можна домовитися» спосіб узгоджується зі продавцем.', selector: '[data-guide="delivery-options"]' },
        { text: 'Після вибору поштової доставки вкажіть зручного оператора.', selector: '[data-guide="delivery-POSTAL_DELIVERY"] .postal-operators', conditional: true },
        { text: 'Опублікований запит можуть знайти продавці. Їхні пропозиції ви побачите в «Мої запити» і зможете порівняти перед вибором та погодженням угоди.', selector: '[data-guide="listing-publish"]' },
    ]
    if (path === '/discover' || path === '/' || path === '/map') return [
        { text: 'Введіть назву, щоб знайти товар або потребу покупця.', selector: '.map-search-main' },
        { text: 'Категорія звужує результати; характеристики оголошення можна переглянути в його деталях.', selector: '.map-search-category' },
        { text: 'Оберіть місто і радіус або шукайте поруч: так легше знайти продавця чи покупця поблизу.', selector: '.map-search-row' },
        { text: 'Перемикачі показують продавців і запити покупців; фільтр способу отримання уточнює результати.', selector: '.map-filter-row' },
        { text: 'Переміщуйте та наближайте мапу. Натисніть маркер або групу, щоб побачити оголошення.', selector: '.map-canvas' },
        { text: 'Картки результатів допомагають відкрити товар, запит або профіль і порівняти пропозиції.', selector: '.map-summary' },
    ]
    if (path.startsWith('/my/requests')) return [
        { text: 'Відкрийте власний запит та перегляньте пропозиції продавців.' },
        { text: 'Порівняйте умови й натисніть «Обрати пропозицію», якщо вона підходить.', selector: '.request-offers' },
        { text: 'Перевірте кількість та підтвердьте вибір. Далі очікуйте підтвердження продавця.' },
    ]
    if (path.startsWith('/settings/demand-subscriptions')) return [
        { text: 'Підписка повідомляє про нові запити, які відповідають вашим умовам. Натисніть «Додати підписку».', selector: '.demand-subscriptions .primary-button' },
        { text: 'Оберіть категорію: підписка охоплює і її підкатегорії.', selector: '.subscription-form', conditional: true },
        { text: 'Виберіть країни, області або міста; для міст можна врахувати передмістя.', selector: '.subscription-form', conditional: true },
        { text: 'За потреби уточніть кількість, ціну та спосіб передачі й збережіть активну підписку.', selector: '.subscription-form', conditional: true },
        { text: 'Про відповідні нові запити надходять сповіщення. Їх можна переглянути за дзвіночком.', selector: '.demand-subscriptions' },
        { text: 'Збережену підписку можна редагувати або вимкнути у списку.', selector: '.demand-subscriptions' },
    ]
    if (path.startsWith('/requests') || path.startsWith('/buy-requests')) return [
        { text: 'Знайдіть запит покупця та відкрийте його умови.', selector: '.request-search-bar' },
        { text: 'Натисніть «Запропонувати», вкажіть товар, кількість, ціну і доставку та перевірте дані перед надсиланням.', selector: '.seller-offer-form' },
    ]
    if (path.startsWith('/settings/profile')) return [{ text: 'У профілі налаштуйте особисті дані та публічне місце. Перед збереженням перевірте видимість адреси.', selector: '.profile-view' }]
    if (path.startsWith('/favorites')) return [{ text: 'В обраному зберігаються позначені товари, запити й профілі. Перемикайте вкладки, щоб повернутися до них.', selector: '.favorites-view .activity-tabs' }]
    if (path.startsWith('/notifications')) return [{ text: 'Тут зібрані події щодо покупок і продажів. Сповіщення на пристрої вмикаються окремо за вашою згодою.', selector: '.notifications-view' }]
    if (path.startsWith('/cabinet')) return [{ text: 'У кабінеті зібрані ваші оголошення та налаштування. Якщо браузер підтримує встановлення, тут доступна відповідна кнопка.', selector: '.cabinet-view' }]
    if (path.startsWith('/messages')) return [{ text: 'Виберіть розмову, щоб переглянути листування і написати співрозмовнику.', selector: '.messages-sidebar' }, { text: 'Перш ніж надіслати повідомлення або пропозицію, перевірте їхній зміст.', selector: '.messages-dialog' }]
    if (path.startsWith('/orders')) return [{ text: 'Відкрийте потрібну домовленість та перевірте її стан і умови.' }, { text: 'Доступні дії для завершення залежать від стану угоди; уважно перевіряйте підтвердження.' }]
    return [{ text: 'Виберіть запитання нижче або відкрийте пошук, щоб почати.' }]
}
