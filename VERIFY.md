# Verification Suite

This repository exposes a repeatable set of diagnostics that cover the client, server, transport guarantees, database state,
browser E2E, and a lightweight load test. Run the commands below from the repository root.

```bash
docker compose up -d      # MongoDB + Redis
npm ci
npm run verify:client
npm run verify:server
npm run verify:ciphertext
npm run verify:e2e
npm run verify:db
npm run verify:load
```

## E2E (Playwright)

```bash
E2E_BASE_URL=http://localhost:3000 \
E2E_API_URL=http://localhost:8080 \
npm run verify:e2e
```

- Ensure the web frontend and API are accessible at the URLs above (override via env vars as needed).
- Test artefacts: `client/playwright-report/` (view with `npx playwright show-report client/playwright-report`).

## Load (Artillery)

```bash
export ART_TOKEN="<jwt участника>"
export ART_CHAT_ID="<существующий chatId>"
npm run verify:load
```

- Scenario target is `http://localhost:8080` by default; adjust via Artillery CLI flags if required.
- Expect ≤1% errors and review `p95` latency in the console output. Redirect stdout/stderr to capture the report if desired.

## Additional Reports

- **Ciphertext verifier** – `scripts/verify-ciphertext.mjs` prints diagnostics and exits non-zero if plaintext fields, non-base64 payloads, or rejected ciphertext are observed.
- **Database verifier** – `scripts/verify-db.mjs` inspects the `messages` collection for plaintext leakage and prints a one-line summary.
- **verify:all** – `npm run verify:all` chains all scripts and fails fast on the first error, making it suitable for CI pipelines.
