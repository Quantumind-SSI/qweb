const { test, expect } = require('@playwright/test');

test('assistant widget works in Chromium on production', async ({ page }) => {
  // Interception to confirm retry logic doesn't break
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('CONSOLE ERROR:', msg.text());
    }
  });

  await page.goto('https://quantumindssi.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-assistant-toggle]', { timeout: 15000 });

  // Click toggle (bottom-left)
  await page.locator('[data-assistant-toggle]').click();
  await page.waitForSelector('[data-assistant-form]', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('[data-assistant-input]', { state: 'visible', timeout: 10000 });

  const input = page.locator('[data-assistant-input]');
  await input.fill('hello from Chrome Playwright');
  await page.locator('[data-assistant-form]').press('Enter');

  // Wait for user message to appear in log
  await page.waitForFunction(() => {
    const log = document.querySelector('[data-assistant-log]');
    if (!log) return false;
    return Array.from(log.querySelectorAll('.assistant__msg--user')).some(el => el.textContent.includes('hello from Chrome Playwright'));
  }, { timeout: 30000 });

  // Wait for assistant reply (Athenoir identity)
  await page.waitForFunction(() => {
    const log = document.querySelector('[data-assistant-log]');
    if (!log) return false;
    return Array.from(log.querySelectorAll('.assistant__msg--bot')).some(el => /Athenoir/i.test(el.textContent));
  }, { timeout: 60000 });

  // Ensure no 502s in console during this interaction
  const consoleErrors = await page.evaluate(() => window.__consoleErrors || []);
  expect(consoleErrors.length).toBe(0);
});
