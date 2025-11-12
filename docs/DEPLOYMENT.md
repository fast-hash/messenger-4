# Deployment Guide

## Предпосылки

- Node.js 22.19.0 и npm 10.x.
- Docker и Docker Compose для MongoDB и Redis.
- Для браузерных тестов: `npx playwright install --with-deps`.

## Переменные окружения

Используйте `.env.example` как шаблон; заполните значения для MongoDB, Redis, JWT и лимитов трафика перед запуском.【F:.env.example†L1-L17】

Ключевые параметры:

- `PORT`, `MONGO_URL`, `REDIS_URL`
- `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`
- `CIPHERTEXT_MAX_BYTES`, `REPLAY_TTL_SECONDS`
- `SOCKET_ALLOWED_ORIGINS`, `VITE_API_BASE_URL`

## Docker Compose

В репозитории лежит `docker-compose.yml`, поднимающий MongoDB и Redis с томами для данных.【F:docker-compose.yml†L1-L16】

```yaml
docker compose up -d
```

## Сборка и тесты

```bash
docker compose up -d
npm ci
npm run build
npm -w client run build
npm -w server test
npm -w client test
```

Для полного аудита выполните сценарии из [docs/VERIFY.md](VERIFY.md).

## Мониторинг и обслуживание

- Логи сервера доступны через `docker compose logs server` или прокси-процесс, в продакшене перенаправляйте stdout/stderr в систему логирования.
- Лимиты можно корректировать через переменные окружения `RATE_LIMIT_*` и `REPLAY_TTL_SECONDS` без изменения кода.【F:server/src/routes/messages.js†L13-L26】
- Регулярно обновляйте зависимости (`npm audit`, `npm update`) и пересобирайте клиент.
