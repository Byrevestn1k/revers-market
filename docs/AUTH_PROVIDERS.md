# Зовнішні способи входу

Кожен спосіб входу веде до одного внутрішнього `users.id`. Ідентичність провайдера зберігається в `auth_identities` за парою `provider + provider_user_id`. Збіг електронної пошти не підключає акаунти автоматично.

## Конфігурація

Задайте у серверному `.env` змінні з [.env.example](../.env.example). `PUBLIC_API_URL` — публічна адреса сайту, через яку `/api` потрапляє до Express. Для локального Vite це та сама адреса, яку відкриває браузер, наприклад `http://127.0.0.1:5173`. У production вона має бути HTTPS. Не створюйте callback URL зі службових `Host` або `X-Forwarded-*` заголовків.

Для кожного провайдера зареєструйте точну адресу:

```text
{PUBLIC_API_URL}/api/auth/external/google/callback
{PUBLIC_API_URL}/api/auth/external/facebook/callback
{PUBLIC_API_URL}/api/auth/external/telegram/callback
```

Налаштуйте reverse proxy, щоб ці адреси передавалися до Express разом із cookie. Проксі має обслуговувати frontend і `/api` на одному публічному origin. Якщо ID, secret або `PUBLIC_API_URL` відсутні, спосіб входу не показується. Секрети зберігаються лише на backend.

## Google

Створіть OAuth Web application у Google Cloud, налаштуйте consent screen і додайте точний callback URL. Укажіть `GOOGLE_CLIENT_ID` і `GOOGLE_CLIENT_SECRET`. Запитуються лише `openid profile email`. Сервер перевіряє підписаний ID token, `iss`, `aud`, обов’язкові числові `exp` та `iat`, і `nonce`; стабільний ключ акаунта — `sub`.

[Документація Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)

## Facebook

Створіть Meta app з Facebook Login, додайте точний Valid OAuth Redirect URI і вкажіть `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`. `FACEBOOK_GRAPH_VERSION` задає версію Graph API, типово `v23.0`. Запитуються лише `public_profile,email`. Email може бути відсутнім. До переходу app у Live mode тестувати вхід можуть тільки дозволені ролі або тестові користувачі Meta. Сервер обмінює код, перевіряє токен через `debug_token` і читає `/me` з `appsecret_proof`.

[Документація Meta Facebook Login](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow)

## Telegram

У `@BotFather` відкрийте налаштування Login Widget для бота, зареєструйте origin сайту й точний callback URL, отримайте Client ID та Client Secret. Задайте `TELEGRAM_CLIENT_ID` і `TELEGRAM_CLIENT_SECRET`. Використовується актуальний OIDC Authorization Code Flow із PKCE S256, `state` і `nonce`. Сервер перевіряє підпис ID token, `iss`, `aud`, обов’язкові числові `exp` та `iat`, і `nonce`. Запитуються лише `openid profile`; номер телефону та право надсилати повідомлення не запитуються. Telegram не надає email у цьому профілі, тому користувач вводить справжню адресу під час завершення реєстрації.

[Документація Telegram Login](https://core.telegram.org/bots/telegram-login)

## Реєстрація та підключення

Якщо незнайомий спосіб входу використано на сторінці входу, система не створює профіль і не підключає його за збігом email, телефону чи імені. Користувач обирає: увійти в існуючий профіль і підтвердити підключення або створити новий. На сторінці реєстрації можна перейти одразу до форми створення. Операція очікування зберігається на сервері до 10 хвилин і використовується один раз. Підключення до існуючого профілю вимагає нового входу в нього після початку операції. Якщо email провайдера вже належить профілю Marketplace, створення нового профілю заблоковано, але сам збіг не підтверджує власника.

Новий користувач заповнює логін, справжній email і телефон. Це наявні обов’язкові поля Marketplace; пароль для такого акаунта лишається порожнім. Email підтверджується звичайним механізмом застосунку. У «Налаштування профілю → Способи входу» видно підключені Google, Facebook, Telegram і пароль окремо від контактних даних профілю. Підключення не переписує профіль Marketplace. Від’єднання останнього способу входу заборонено сервером.

Підключення нового способу входу з налаштувань потребує нового входу в Marketplace: поточна сесія має бути створена не більш як 10 хвилин тому. Сервер перевіряє її свіжість при start, повторно в callback після provider exchange і безпосередньо перед збереженням identity. Стара сесія отримує `403 REAUTH_REQUIRED`. OAuth state зберігається серверно, діє до 10 хвилин і споживається один раз; клієнт не передає ознаку «свіжого» входу. Реальні OAuth сценарії провайдерів залишаються UNVERIFIED.

Реальні OAuth сценарії потребують власних налаштованих provider apps і мають перевірятися окремо від автоматизованих тестів із підставними відповідями провайдерів.
