---
marp: true
theme: default
paginate: true
---

# Secure Messenger RC

Корпоративный мессенджер с end-to-end шифрованием и self-check suite.

---

## Проблема и контекст
- В корпоративных чатах нельзя доверять серверу с plaintext.
- Существующие решения (Signal, Teams, Slack) либо не self-hosted, либо не E2E.
- Требуется защищённая альтернатива с верифицируемым пайплайном.

---

## Требования ТЗ
- Клиент ↔ сервер только через base64-шифротекст.
- JWT-аутентификация REST и Socket.IO.
- Replay protection, rate-limit, строгая CSP.
- Полный комплект тестов: unit, integration, e2e, load.

---

## Архитектура
```mermaid
graph TD
  A[Client
  (React + WebCrypto + Worker)] -->|REST /auth,/keybundle,/messages| B[Express API]
  A -->|Socket.IO (JWT)| B
  B -->|ciphertext| C[(MongoDB)]
  B -->|replay digests| D[(Redis)]
```

---

## Протокол и ключи
- X3DH-совместимые pre-keys: identity + signed + one-time.【F:client/src/crypto/signal.js†L1-L226】【F:client/src/crypto/keystore.js†L1-L252】
- Сессии Signal хранятся в воркере и синхронизируются без утечки приватников.
- Сообщения — AES-GCM/XChaCha20 через libsignal; сериализация только base64.

---

## Сервер «слепой»
- `/api/messages` принимает только `{ chatId, encryptedPayload }` и проверяет base64 + лимиты.【F:server/src/routes/messages.js†L17-L68】
- Сообщения сохраняются в MongoDB без поля `text`.【F:server/src/models/Message.js†L1-L16】
- Replay guard на Redis с SHA-256 дайджестами.【F:server/src/services/replayGuard.js†L1-L67】

---

## Replay guard и Socket JWT
- Redis `set NX EX` предотвращает повторную доставку.
- Socket.IO требует JWT, проверяет аудит/issuer и членство чата перед join.【F:server/src/app.js†L78-L142】
- Эмиссия сообщений происходит только после записи в БД.

---

## Клиентский keystore
- Identity и pre-keys шифруются AES-GCM (WebCrypto) с PBKDF2 по парольной фразе.【F:client/src/crypto/keystore.js†L200-L252】
- IndexedDB + in-memory fallback; приватники никогда не попадают в localStorage.

---

## Тестовая пирамида
- Unit: Signal round-trip, negative cases, REST валидация.
- Integration: HTTP round-trip, replay, socket auth.
- E2E: Playwright проверяет base64 на проводе и UI расшифровку.【F:client/e2e/chat.spec.ts†L1-L91】
- Load: Artillery удерживает ошибки ≤1% при потоке ciphertext.【F:load/basic.yml†L1-L18】

---

## Демонстрация
1. Запустить `docker compose up -d` и `npm run verify:e2e`.
2. Открыть два браузера, авторизоваться и отправить «Привет».
3. В DevTools Network убедиться, что `/api/messages` содержит только `{ chatId, encryptedPayload }`.

---

## Риски и смягчение
- `libsignal-protocol.js` содержит `eval` → запускается в воркере, CSP без `unsafe-eval`.
- `protobufjs`, `tar-fs`, `ws`, `tmp` — известные advisories; прод не использует marp/Artillery.
- Повторное использование pre-keys мониторится и перезаполняется при исчерпании.

---

## Результаты и метрики
- Сервер хранит только base64 ciphertext; верификация скриптами `verify:ciphertext` и `verify:db`.
- E2E тест подтверждает расшифровку «Привет» у собеседника.
- Нагрузка Artillery: ошибки ≤1%, p95 в рабочем диапазоне.

---

## Дальнейшие планы
- Автоматическая ротация pre-keys и уведомления об исчерпании.
- Поддержка групповых чатов (sender keys / Megolm).
- Шифрование файлов (AES-GCM + streaming) и мобильные клиенты.

---

# Спасибо!
Вопросы и демо — [docs/VERIFY.md](../docs/VERIFY.md)
