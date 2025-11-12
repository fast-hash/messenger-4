import { test, expect } from '@playwright/test';

test('CSP is strict: no unsafe, has worker-src and ws', async ({ request, baseURL }) => {
  const target = baseURL || process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
  const res = await request.get(target);
  expect(res.ok()).toBeTruthy();

  const csp = res.headers()['content-security-policy'] || '';
  // Базовые ожидания
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("object-src 'none'");
  // Нет опасных директив
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  // Разрешены ws/wss и worker/blob
  expect(csp).toContain("connect-src 'self' ws: wss:");
  expect(csp).toContain("worker-src 'self' blob:");
});
