import { test, expect } from '@playwright/test';

const pages = [
  { name: 'Home / Login', path: '/' },
  { name: 'Admin Dashboard', path: '/admin-dashboard.html' },
  { name: 'HR Dashboard', path: '/hr-dashboard.html' },
  { name: 'Manager Dashboard', path: '/manager-dashboard.html' },
  { name: 'Employee Dashboard', path: '/employee-dashboard.html' },
];

test.describe('BexHR whole-app smoke tests', () => {
  for (const appPage of pages) {
    test(`${appPage.name} loads without a blank page`, async ({ page }) => {
      const pageErrors = [];

      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      const response = await page.goto(appPage.path, {
        waitUntil: 'domcontentloaded',
      });

      expect(response, `${appPage.name} should return a response`).toBeTruthy();
      expect(response.ok(), `${appPage.name} should return a successful HTTP status`).toBeTruthy();

      const bodyText = await page.locator('body').innerText({
        timeout: 10000,
      });

      expect(
        bodyText.trim().length,
        `${appPage.name} should not render a blank page`,
      ).toBeGreaterThan(0);

      expect(
        pageErrors,
        `${appPage.name} should not throw browser page errors`,
      ).toEqual([]);
    });
  }
});
