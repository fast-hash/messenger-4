# Defense Checklist

| Пункт ТЗ                | Где посмотреть                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Анализ и архитектура    | [docs/ARCHITECTURE.md](ARCHITECTURE.md), [docs/THREAT-MODEL.md](THREAT-MODEL.md)                        |
| Требования и протокол   | [docs/SECURITY.md](SECURITY.md), [docs/API.md](API.md)                                                  |
| Реализация клиента      | `client/src/crypto/signal.js`, `client/src/crypto/keystore.js`, `client/src/api/api.js`                 |
| Реализация сервера      | `server/src/app.js`, `server/src/routes/messages.js`, `server/src/services/replayGuard.js`              |
| Тестирование            | [docs/TEST_PLAN.md](TEST_PLAN.md), `client/test/*.mjs`, `server/test/*.test.js`, `scripts/verify-*.mjs` |
| Нагрузочное и e2e       | `client/e2e/chat.spec.ts`, `load/basic.yml`, [docs/VERIFY.md](VERIFY.md)                                |
| Безопасность и политика | [docs/SECURITY.md](SECURITY.md), [docs/VULNERABILITIES.md](VULNERABILITIES.md)                          |
| Документация            | [docs/](.) каталог, README.md                                                                           |
| Демонстрация            | [slides/deck.md](../slides/deck.md), Playwright отчёт (`client/playwright-report/`)                     |
