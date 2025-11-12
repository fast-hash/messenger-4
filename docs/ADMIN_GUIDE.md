# Руководство администратора

## Настройка окружения

1. Скопируйте `.env.example` и заполните значения для подключения к MongoDB, Redis и секреты JWT.【F:.env.example†L1-L17】
2. Убедитесь, что `SOCKET_ALLOWED_ORIGINS` содержит список доменов клиентов, иначе Socket.IO отклонит соединения.【F:server/src/app.js†L78-L118】

## Политики безопасности

- Регулярно меняйте `JWT_SECRET` и перезапускайте сервер, чтобы аннулировать старые токены.
- Настройте CORS через `server.cors.origins` в `config/*.json`, чтобы ограничить доверенные фронтенды.【F:config/default.json†L1-L11】
- Rate-limit (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`) снижает эффект DoS и конфигурируется без перекомпиляции.【F:server/src/app.js†L45-L59】

## Мониторинг

- Логи идут через morgan и `app.locals.logger`. По умолчанию не содержат тел запросов, можно переадресовать в централизованную систему логов.【F:server/src/app.js†L31-L43】
- Отслеживайте Redis на предмет ошибок подключения (`[redis]` сообщения в логах).【F:server/src/services/replayGuard.js†L20-L49】

## Бэкапы

- MongoDB: используйте `mongodump`/`mongorestore` с шифрованными storage-бекапами.
- Redis: включите RDB/Append Only и делайте периодические дампы ключей `replay:*` (не содержат plaintext).

## Обновления

- Периодически выполняйте `npm run audit:ci` и обновляйте зависимости; смотрите [docs/VULNERABILITIES.md](VULNERABILITIES.md).
- Для клиента запускайте `npm -w client run build` перед релизом, чтобы убедиться в отсутствии предупреждений.

## Отладка

- При включении кастомного `messageObserver` в `createApp` можно собирать метрики по ciphertext без доступа к plaintext.【F:server/src/app.js†L49-L70】
- Не добавляйте логирование `req.body` — это нарушит политику «сервер слепой» и может привести к утечке секретов.
