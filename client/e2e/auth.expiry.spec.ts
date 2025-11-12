import { test, expect } from '@playwright/test';

test('expired JWT triggers WS disconnect fast', async ({ page }) => {
  await page.goto('/');
  // подстрой при необходимости: UI должен отобразить дисконнект/неавторизован
  const status = page.locator('[data-test=ws-status]');
  await expect(status).toHaveText(/disconnected|unauthorized/i, { timeout: 5000 });
});
