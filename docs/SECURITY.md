# Security Overview

## Основные принципы

- **Сервер слепой**: роутер `/api/messages` принимает только `{ chatId, encryptedPayload }`, отклоняя plaintext и превышение длины, а затем пишет то же самое в MongoDB.【F:server/src/routes/messages.js†L17-L68】【F:server/src/models/Message.js†L1-L16】
- **Base64 на проводе**: клиент шифрует сообщения и сериализует их в base64 через Signal worker перед отправкой.【F:client/src/api/api.js†L9-L24】【F:client/src/crypto/signal.js†L206-L226】
- **Лог-гигиена**: middleware `messageObserver` и маршруты не выводят тела запросов; журналирование ограничено кодовыми словами и ошибками через `req.app.locals.logger`.【F:server/src/app.js†L33-L70】【F:server/src/routes/auth.js†L9-L44】
- **Транспортная защита**: Helmet, CORS со списком доменов, и rate-limit для `/api/messages` предотвращают brute-force и злоупотребления API.【F:server/src/app.js†L31-L59】
- **Строгая CSP**: браузерная оболочка запрещает `unsafe-eval`, разрешая libsignal только внутри воркера.【F:client/index.html†L6-L12】

## Управление ключами

- Клиент хранит приватные ключи в IndexedDB, шифруя их WebCrypto (AES-GCM) с ключом, полученным через PBKDF2 от пользовательской парольной фразы.【F:client/src/crypto/keystore.js†L1-L120】【F:client/src/crypto/keystore.js†L200-L252】
- Identity и pre-keys синхронизируются с крипто-воркером для работы libsignal, но никогда не покидают браузер в открытом виде.【F:client/src/crypto/signal.js†L12-L120】
- Node-воркер подключается только в тестах и выполняется из локального файла libsignal; в продакшене браузерный воркер импортируется через `importScripts` в изолированной среде.【F:client/src/crypto/worker/crypto.browser.worker.js†L1-L18】【F:client/src/crypto/worker/crypto.node.worker.js†L1-L22】
- JWT_CLOCK_TOLERANCE_SEC = 120 # допуск для exp/nbf

## Keystore (client)

- Vault: IndexedDB, формат { v, kdf{PBKDF2/SHA-256, iterations=310000, salt}, cipher{AES-GCM, iv}, ct }.
- Смена пароля: re-wrap содержимого с новыми salt/iv, атомарная запись (одна транзакция IndexedDB).
- Запрещён localStorage/sessionStorage (ESLint), ключи неэкстрактируемые.

## Replay Guard

Redis хранит `replay:{chatId}:{sha256(payload)}` с TTL, что предотвращает повторное воспроизведение зашифрованных пакетов.【F:server/src/services/replayGuard.js†L1-L67】

## Socket.IO

- Хендшейк требует JWT из заголовка Authorization; при невалидном токене соединение отклоняется.【F:server/src/app.js†L78-L115】
- После проверки пользователь может присоединиться только к комнатам чатов, участником которых является, иначе возвращается ошибка `forbidden`.【F:server/src/app.js†L115-L142】【F:server/src/models/Chat.js†L1-L24】

## Ограничения и известные риски

- **libsignal-protocol.js** содержит `eval` (Emscripten), поэтому исполняется исключительно в воркере; CSP документа исключает `unsafe-eval`, снижая риск XSS исполняемого кода.【F:client/index.html†L6-L12】【F:client/src/crypto/worker/crypto.browser.worker.js†L1-L18】
- **`protobufjs` advisory**: транзитивная зависимость libsignal. Используется только на клиенте в воркере; сервер не исполняет библиотеку, поэтому риск ограничен локальной средой браузера.
- **`tmp` через Artillery**: dev-зависимость для нагрузочного теста, не входит в продакшен. План — отслеживать обновления и заменить на встроенную генерацию временных файлов при появлении фикса.
