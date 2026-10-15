const { test, expect } = require('@playwright/test');

test('assistant widget appears and opens', async ({ page }) => {
  await page.goto('http://localhost:8082/');
  await page.waitForSelector('[data-assistant-toggle]', { timeout: 10000 });
  const toggle = await page.locator('[data-assistant-toggle]');
  await toggle.click();
  await expect(page.locator('[data-assistant-form]')).toBeVisible();
  await expect(page.locator('[data-assistant-input]')).toBeVisible();
});

test('assistant widget type and send', async ({ page }) => {
  await page.goto('http://localhost:8082/');
  await page.locator('[data-assistant-toggle]').click();
  const input = page.locator('[data-assistant-input]');
  await input.fill('Hello widget');
  await page.locator('[data-assistant-form]').press('Enter');
  await expect(page.locator('[data-assistant-log]').getByText('Hello widget', { exact: false })).toBeVisible({ timeout: 10000 });
});
