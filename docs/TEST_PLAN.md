# План тестирования

## Покрытие

- **Unit (client)**: round-trip и негативные сценарии для Signal/crypto, гарантируя, что шифрование/дешифрование работает и ломается при порче данных.【F:client/test/signal.test.mjs†L1-L80】
- **Unit (server)**: валидация REST-роутов (401/403/413/422), reject plaintext, проверка replay guard и Socket.IO авторизации.【F:server/test/messages.ciphertext.test.js†L1-L83】【F:server/test/messages.more.test.js†L1-L78】【F:server/test/replay.test.js†L1-L58】【F:server/test/socket.auth.test.js†L1-L100】
- **Integration**: HTTP round-trip с проверкой сохранения только ciphertext и корректной истории.【F:server/test/http.roundtrip.test.js†L1-L90】
- **E2E (Playwright)**: A↔B обмен с проверкой base64 в сети и расшифровкой в UI.【F:client/e2e/chat.spec.ts†L1-L91】
- **Нагрузочные**: Artillery сценарий шлёт ciphertext и проверяет коды ответов.【F:load/basic.yml†L1-L18】

## Команды и критерии успеха

| Команда                     | Назначение                                                           | Ожидание                                                      |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm -w client run build`   | Production-сборка клиента                                            | Завершается без ошибок и предупреждений о node:\* модулях     |
| `npm -w client test`        | Юнит-тесты клиента                                                   | Зелёные round-trip и негативные кейсы                         |
| `npm -w server test`        | Серверные unit/integration                                           | Все проверки статусов и replay guard проходят                 |
| `npm run verify:server`     | Быстрая проверка сервера (lint + tests)                              | Без ошибок линтера и падающих тестов                          |
| `npm run verify:ciphertext` | Автоматический аудит API/БД                                          | Plaintext отвергается, ciphertext проходит, в БД нет `text`   |
| `npm run verify:db`         | Проверка состояния реальной БД                                       | Найдены только base64-поля, нет plaintext                     |
| `npm run verify:e2e`        | Playwright e2e (предварительно `npx playwright install --with-deps`) | Оба браузера видят расшифрованный текст, сеть — только base64 |
| `npm run verify:load`       | Нагрузочный тест Artillery                                           | Ошибок ≤ 1%, p95 в разумных пределах                          |

## Дополнительно

- Husky pre-commit гоняет форматирование, линтер и быстрые тесты, предотвращая попадание нарушений в репозиторий.【F:.husky/pre-commit†L1-L16】
- `npm run verify:all` объединяет все проверки в последовательный прогон для CI или ручного контроля.【F:package.json†L9-L27】
