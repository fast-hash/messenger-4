# Self-check & Verification Suite

## Подготовка

```bash
docker compose up -d
npm ci
```

## Клиент

```bash
npm -w client run build
npm -w client test
```

## Сервер

```bash
npm -w server test
npm run verify:server
```

## Ciphertext-only аудит

```bash
npm run verify:ciphertext
npm run verify:db
```

Скрипты поднимают MongoDB в памяти, отправляют как plaintext, так и ciphertext, и убеждаются, что сервер отклоняет открытый текст и хранит только base64.【F:scripts/verify-ciphertext.mjs†L1-L100】【F:scripts/verify-db.mjs†L1-L55】

## E2E (Playwright)

```bash
npx playwright install --with-deps
npm run verify:e2e
```

Артефакты и репорт находятся в `client/playwright-report/` (HTML), трейсы и видео сохраняются для повторной диагностики.【F:client/playwright.config.ts†L1-L9】

## Нагрузка (Artillery)

```bash
export ART_TOKEN=<jwt>
export ART_CHAT_ID=<existingChatId>
npm run verify:load
```

Сценарий шлёт только `{ chatId, encryptedPayload }` и ожидает коды 200.【F:load/basic.yml†L1-L18】 Отчёт Artillery выводится в stdout; сохраните p95 latency и процент ошибок в журнал проверки.

## Полный прогон

```bash
npm run verify:all
```

Команда объединяет все шаги и позволяет быстро проверить билд перед защитой.【F:package.json†L9-L27】
