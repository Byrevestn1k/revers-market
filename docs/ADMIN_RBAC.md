# Admin RBAC — Частини 1–2

Permissions перевіряються backend для кожного `/api/admin/*` запиту. Cookie session із чинною автентифікацією + `admin.access` обов’язкові; приховане меню не є контролем доступу. Призначення зберігаються окремо від користувацького профілю: той самий користувач може купувати й продавати.

## Початкова матриця

| Permission | Super Admin | Admin | Moderator | Support Agent | Analyst |
|---|---|---|---|---|---|
| admin.access | ✓ | ✓ | ✓ | ✓ | ✓ |
| analytics.read | ✓ | ✓ | | | ✓ |
| users.read | ✓ | ✓ | ✓ | ✓ | |
| products.read | ✓ | ✓ | ✓ | | |
| requests.read | ✓ | ✓ | ✓ | | |
| offers.read | ✓ | ✓ | | ✓ | |
| deals.read | ✓ | ✓ | | ✓ | |
| moderation.read | ✓ | ✓ | ✓ | ✓ | |
| audit.read | ✓ | ✓ | | | |
| roles.read | ✓ | ✓ | | | |
| roles.manage | ✓ | | | | |

Назви ролей не використовуються як універсальний доступ до приватних даних. Списки користувачів не містять email/телефону, пропозиції й угоди не містять фото/умов/повідомлень; модерація не повертає довільний текст скарги. `roles.read` дозволяє перевірку активних призначень за UUID; зміни потребують `roles.manage`.

## Призначення й сесії

- Дозволи читаються з БД на кожний запит; кеш permission не використовується. Строкові/відкликані grants перестають діяти серверно.
- POST/DELETE grants потребують точного Origin із `FRONTEND_URL`, `X-Admin-Action: 1`, JSON та сесії, створеної менш ніж годину тому. HTTPS cookie Secure у production успадкований від auth.
- Самопризначення і самовідкликання заборонені. Через HTTP не можна призначати/відкликати Super Admin чи призначати будь-яку роль із `roles.manage`.
- Дозволені коди причини: `access_assignment`, `access_review`, `incident_response`. Підтвердження в UI не замінює backend перевірки.
- Зміна grant та audit `admin.grant_created`/`admin.grant_revoked` виконуються в одній транзакції; advisory lock серіалізує зміни й permission повторно перевіряється всередині транзакції.
- Вхід через наявний `/api/auth/login` обмежений 10 спробами за хвилину на socket IP. Загальний admin API має ліміт 90 запитів/хвилину. За reverse proxy потрібен перевірений edge limiter: без довіреної proxy-конфігурації всі відвідувачі можуть ділити socket IP.
- Чинна auth session живе до 7 днів; окремий короткий staff idle timeout/MFA не реалізований. **MFA є вимогою перед production** для привілейованих акаунтів, включно з recovery та повторною перевіркою критичних дій. Усі способи входу мають однаково дотримуватися цієї майбутньої policy.

## Контрольоване створення Super Admin

Тільки оператор з доступом до backend і цільової БД може виконати:

```sh
ADMIN_BOOTSTRAP_ACK=GRANT_SUPER_ADMIN npm run admin:bootstrap --workspace backend -- <existing-user-uuid>
```

`DATABASE_URL` задається захищеним середовищем. Перевірити БД і UUID перед запуском; не використовувати цей приклад як дозвіл на основну БД. CLI не створює облікового запису/пароля й записує audit із `actor_id=NULL`, `reason=controlled_cli_bootstrap`, цільовим UUID та результатом. Ідентичність оператора має зберігатися в захищеному операційному журналі. HTTP endpoint bootstrap відсутній. Offline відкликання Super Admin потребує окремої контрольованої операторської транзакції з audit; відповідного CLI ще немає.

## Audit та залишкові межі

Існуючий `audit_logs` перевикористано. Admin list повертає `admin.*` та історичні `report.moderated`, actor/time/entity/action/result/reason, без raw metadata. Паролі, токени, приватний текст і координати не записуються новим модулем. Відхилені запити повертають 4xx; вони не створюють durable audit-подій у цьому MVP. Історію інших moderation/dispute операцій треба інтегрувати окремо.

Reports API переведено на RBAC у Частині2; legacy PATCH reports повертає410 і не приймає рішення. Решта історичних category/dispute `MODERATOR_USER_IDS` routes не переписується цим етапом. Розширення доступу робити через permissions, а не через перевірку `role === admin`. Для нових HTTP дій потрібні власні permissions, валідація, захист сесії/Origin, транзакційний audit та негативні тести.

## Нові permissions Частини2

| Permission | Super Admin | Admin | Moderator | Support Agent | Analyst |
|---|---|---|---|---|---|
| products.moderate | ✓ | ✓ | ✓ | | |
| requests.moderate | ✓ | ✓ | ✓ | | |
| moderation.decide | ✓ | ✓ | ✓ | | |
| users.restrict | ✓ | ✓ | | | |

Moderator додатково отримує users.read для дозволеного перегляду публічного профілю/історії. Дозвіл users.restrict можна надати через контрольоване визначення role permissions; назва Moderator сама по собі не дозволяє бан. Support за замовчуванням лише читає; Analyst не отримує операційного редагування. Super/Admin не можуть через HTTP обмежувати себе або активного staff-користувача. roles.manage залишається тільки Super Admin із правилами Частини1.

Усі action endpoints використовують mutationProtection, version + requestKey, транзакційний audit і повторну перевірку permission під тим самим lock, що grants. Причина — allowlisted code, ban — тільки тимчасовий до30 днів. Активне обмеження перевіряється на кожне використання сесії; новий login не обходить ban. Власник об’єкта може редагувати свої комерційні поля, але не moderation flag. Точний контракт, видимість, обмеження оскаржень і локальний запуск: [ADMIN_PANEL_PART2.md](ADMIN_PANEL_PART2.md).
