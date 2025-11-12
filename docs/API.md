# API Reference

## REST Endpoints

Полная спецификация доступна в файле [docs/api/openapi.yaml](api/openapi.yaml).

### POST /api/auth/register

- Тело: `{ username, email, password, publicKey }`
- Ответ: `201 { userId }` + HTTP-only cookie `accessToken`
- Ошибки: `400 invalid_payload`, `400 user_exists`
  【F:server/src/routes/auth.js†L162-L198】

### POST /api/auth/login

- Тело: `{ email, password }`
- Ответ: `200 { userId }` + обновлённая cookie `accessToken`
- Ошибки: `400 missing_credentials`, `400 invalid_credentials`, `429 too_many_attempts`
  【F:server/src/routes/auth.js†L201-L225】

### POST /api/auth/logout

- Сбрасывает cookie `accessToken`
- Ответ: `204 No Content`
  【F:server/src/routes/auth.js†L228-L231】

### GET /api/auth/session

- Требует действующую cookie `accessToken`
- Ответ: `200 { userId }`
- Ошибки: `401 unauthorized`
  【F:server/src/routes/auth.js†L233-L235】

### POST /api/keybundle

- Требует cookie `accessToken` или заголовок `Authorization: Bearer <JWT>`
- Тело: `{ identityKey, signedPreKey, oneTimePreKeys: [{ keyId, publicKey }] }`
- Ответ: `204 No Content`
- Ошибки: `400 invalid_payload`, `500 server_error`
  【F:server/src/routes/keybundle.js†L153-L193】

### GET /api/keybundle/:userId

- Требует cookie `accessToken` или заголовок `Authorization`
- Ответ: `{ identityKey, signedPreKey, oneTimePreKey: { keyId, publicKey } }`
- Ошибки: `404 not_found`, `410 no_prekeys`
  【F:server/src/routes/keybundle.js†L196-L240】

### POST /api/messages

- Требует cookie `accessToken` или заголовок `Authorization`
- Тело: `{ chatId: ObjectIdString, encryptedPayload: Base64String }`
- Успех: `200 { ok: true, id }`
- Ошибки: `401 unauthenticated`, `403 forbidden`, `409 duplicate`, `413 ciphertext too large`, `422 invalid chatId/encryptedPayload`
  【F:server/src/routes/messages.js†L38-L99】

### GET /api/messages/:chatId

- Требует cookie `accessToken` или заголовок `Authorization`
- Ответ: `[{ id, chatId, senderId, encryptedPayload, createdAt }]`
- Ошибки: `401 unauthenticated`, `403 forbidden`, `422 invalid chatId`
  【F:server/src/routes/messages.js†L134-L206】

## Socket.IO

- Хендшейк: cookie `accessToken` (устанавливается при логине) или явный `Authorization: Bearer <JWT>`/`auth.token`.
- События:
  - `join { chatId }` → ack `{ ok: true }` при участии в чате, иначе `{ ok: false, error }`.
  - `message { id, chatId, senderId, encryptedPayload, createdAt }` — рассылается после записи в БД.
    【F:server/src/app.js†L244-L306】【F:server/src/routes/messages.js†L38-L206】

## Примеры

```json
POST /api/messages
{
  "chatId": "64f1c8e1b4c03f4a2d8f8c11",
  "encryptedPayload": "QUJDRA=="
}
```

```json
GET /api/messages/:chatId
[
  {
    "id": "64f1c8e1b4c03f4a2d8f8c12",
    "chatId": "64f1c8e1b4c03f4a2d8f8c11",
    "senderId": "64f1c8e1b4c03f4a2d8f8c13",
    "encryptedPayload": "QUJDRA==",
    "createdAt": "2024-10-15T12:00:00.000Z"
  }
]
```
