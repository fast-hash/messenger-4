# Secure Messenger

End-to-end зашифрованный корпоративный мессенджер с клиентом на React и сервером на Express.

## Ключевые возможности

- E2E-шифрование на базе libsignal, исполняемое в Web Worker клиента.【F:client/src/crypto/signal.js†L1-L226】【F:client/src/crypto/worker/crypto.browser.worker.js†L1-L18】
- Сервер хранит и ретранслирует только base64-шифротекст, защищая от повторов через Redis.【F:server/src/routes/messages.js†L17-L95】【F:server/src/services/replayGuard.js†L1-L67】
- Встроенные проверки: unit, интеграционные, e2e и нагрузочные тесты доступны из одного verify-набора.【F:docs/TEST_PLAN.md†L1-L25】【F:docs/VERIFY.md†L1-L41】

## Быстрый старт

```bash
docker compose up -d
npm ci
npm run build
npm -w client run build
npm -w server test
npm -w client test
```

## Документация

В каталоге [docs/](docs) собраны материалы для защиты: архитектура, безопасность, threat model, инструкции и чек-листы. Слайды находятся в [slides/deck.md](slides/deck.md).

## Тесты и проверки

```bash
npm run verify:all
```

Команда запускает build/test обоих пакетов, e2e, нагрузочные и аудиты БД/шифротекста.【F:package.json†L9-L27】

Дополнительные команды перечислены в [docs/VERIFY.md](docs/VERIFY.md).
