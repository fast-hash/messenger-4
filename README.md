# Secure Messenger

Корпоративный мессенджер с end-to-end шифрованием: клиент на React/Vite, сервер на Express с Socket.IO и защитой от повторов сообщений через Redis.

## Быстрый старт

### Windows (cmd/PowerShell)

```cmd
cd D:\proj\messenger-3
rem 1) инфраструктура Mongo + Redis
docker compose up -d
rem 2) окружение
copy /Y .env.example .env
copy /Y .env server\.env
copy /Y .env client\.env
rem 3) зависимости и запуск API
cd server
pnpm install
pnpm start
```

### Linux/macOS (bash)

```bash
cd ~/projects/messenger-3
# 1) инфраструктура Mongo + Redis
docker compose up -d
# 2) окружение
cp .env.example .env
cp .env server/.env
cp .env client/.env
# 3) зависимости и запуск API
cd server
pnpm install
pnpm start
```

После запуска сервер печатает `API listening on http://localhost:3000`. Проверка работоспособности:

```bash
curl -i http://localhost:3000/healthz
```

Фронт можно поднять отдельным терминалом:

```cmd
cd D:\proj\messenger-3\client
pnpm install
pnpm dev
```

```bash
cd ~/projects/messenger-3/client
pnpm install
pnpm dev
```

Приложение будет доступно на http://localhost:5173.

## Переменные окружения

| Переменная      | Значение по умолчанию                  | Назначение                                                      |
| --------------- | -------------------------------------- | --------------------------------------------------------------- |
| `PORT`          | `3000`                                 | HTTP-порт API.                                                  |
| `MONGO_URL`     | `mongodb://localhost:27017/messenger3` | Подключение к MongoDB.                                          |
| `REDIS_URL`     | `redis://localhost:6379`               | Подключение к Redis для защиты от повторов.                     |
| `JWT_SECRET`    | _обязательно указать своё_             | Секрет HMAC для JWT. Пустое значение приводит к ошибке запуска. |
| `CORS_ORIGIN`   | `http://localhost:5173`                | Разрешённый origin для REST и Socket.IO.                        |
| `COOKIE_SECURE` | `false`                                | Включить secure-флаг для cookie авторизации.                    |
| `VITE_API_URL`  | `http://localhost:3000`                | URL API/WebSocket для фронтенда (читается Vite-клиентом).       |

Шаблоны `.env.example` лежат в корне проекта, а также в каталогах `server/` и `client/` для изолированного запуска пакетов.

## Матрица портов

| Сервис           | Порт        | Назначение             |
| ---------------- | ----------- | ---------------------- |
| Express API      | `3000/tcp`  | REST + Socket.IO.      |
| React dev server | `5173/tcp`  | Vite (клиент).         |
| MongoDB          | `27017/tcp` | База данных.           |
| Redis            | `6379/tcp`  | Хранилище анти-реплея. |

## Быстрый smoke-тест API

### Bash

```bash
# healthcheck
curl -i http://localhost:3000/healthz

# регистрация (сохранит cookie в cookies.txt)
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.test","password":"Passw0rd!","publicKey":"cHVibGljS2V5SW5CYXNlNjQ="}'

# повторное использование cookie для логина
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.test","password":"Passw0rd!"}'

# отправка зашифрованного сообщения
curl -i -b cookies.txt -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"chatId":"<chatId>","encryptedPayload":"QmFzZTY0UGF5bG9hZA=="}'

# чтение истории (cursor/page опционален)
curl -i -b cookies.txt "http://localhost:3000/api/messages?chatId=<chatId>&limit=50"
```

### Windows cmd

```cmd
:: healthcheck
curl.exe -i http://localhost:3000/healthz

:: регистрация
curl.exe -i -c cookies.txt -X POST http://localhost:3000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"alice\",\"email\":\"alice@example.test\",\"password\":\"Passw0rd!\",\"publicKey\":\"cHVibGljS2V5SW5CYXNlNjQ=\"}"

:: логин
curl.exe -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"alice@example.test\",\"password\":\"Passw0rd!\"}"

:: отправка сообщения
curl.exe -i -b cookies.txt -X POST http://localhost:3000/api/messages ^
  -H "Content-Type: application/json" ^
  -d "{\"chatId\":\"<chatId>\",\"encryptedPayload\":\"QmFzZTY0UGF5bG9hZA==\"}"

:: чтение истории
curl.exe -i -b cookies.txt "http://localhost:3000/api/messages?chatId=<chatId>&limit=50"
```

`<chatId>` берётся из ответа `/api/auth/register`/`/api/messages` или тестовых маршрутов в режиме `NODE_ENV=test`.

## Скрипты

| Команда                      | Назначение                                              |
| ---------------------------- | ------------------------------------------------------- |
| `pnpm run workspace:install` | Установить зависимости во всём workspace.               |
| `pnpm run workspace:build`   | Запустить `build` во всех пакетах, у кого он определён. |
| `pnpm run workspace:dev`     | Запустить `dev`-режимы клиентских и серверных пакетов.  |
| `pnpm run workspace:test`    | Прогнать тесты пакетов (`node --test` на сервере).      |
| `pnpm run workspace:lint`    | Запустить `lint` в пакетах (если определены).           |
| `pnpm run workspace:format`  | Запустить форматирование (если определено).             |

## Полезные материалы

- [docs/TEST_PLAN.md](docs/TEST_PLAN.md) — стратегия тестирования.
- [docs/VERIFY.md](docs/VERIFY.md) — чек-лист проверок.
- [docs/audit-2025-02-12.md](docs/audit-2025-02-12.md) — аудит инфраструктуры.
