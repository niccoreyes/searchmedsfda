import { test, expect } from 'playwright/test';

test('Rx Builder tab displays prescription items', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-tab="rx"]').click();
  await expect(page.locator('#rxItems')).toBeVisible();
});
