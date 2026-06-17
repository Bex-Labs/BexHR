import { test, expect } from '@playwright/test';

const roles = [
  {
    name: 'Admin',
    email: process.env.BEXHR_ADMIN_EMAIL,
    password: process.env.BEXHR_ADMIN_PASSWORD,
    companyId: process.env.BEXHR_ADMIN_COMPANY_ID,
    expectedUrl: /\/admin-dashboard(?:\.html)?\/?(?:[?#].*)?$/i,
  },
  {
    name: 'HR',
    email: process.env.BEXHR_HR_EMAIL,
    password: process.env.BEXHR_HR_PASSWORD,
    companyId: process.env.BEXHR_HR_COMPANY_ID,
    expectedUrl: /\/hr-dashboard(?:\.html)?\/?(?:[?#].*)?$/i,
  },
  {
    name: 'Manager',
    email: process.env.BEXHR_MANAGER_EMAIL,
    password: process.env.BEXHR_MANAGER_PASSWORD,
    companyId: process.env.BEXHR_MANAGER_COMPANY_ID,
    expectedUrl: /\/manager-dashboard(?:\.html)?\/?(?:[?#].*)?$/i,
  },
  {
    name: 'Employee',
    email: process.env.BEXHR_EMPLOYEE_EMAIL,
    password: process.env.BEXHR_EMPLOYEE_PASSWORD,
    companyId: process.env.BEXHR_EMPLOYEE_COMPANY_ID,
    expectedUrl: /\/employee-dashboard(?:\.html)?\/?(?:[?#].*)?$/i,
  },
];

async function fillFirstVisible(page, selectors, value) {
  if (!value) return false;

  for (const selector of selectors) {
    const field = page.locator(selector).first();

    try {
      if (await field.isVisible({ timeout: 1500 })) {
        await field.fill(value);
        return true;
      }
    } catch {
      // Try the next selector.
    }
  }

  return false;
}

async function clickLoginButton(page) {
  const loginButton = page.getByRole('button', {
    name: /sign in|log in|login|continue/i,
  }).first();

  if (await loginButton.count()) {
    await loginButton.click();
    return;
  }

  await page.locator('button[type="submit"], input[type="submit"]').first().click();
}

async function loginAs(page, role) {
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/', {
    waitUntil: 'domcontentloaded',
  });

  await fillFirstVisible(
    page,
    [
      'input[id*="tenant" i]',
      'input[name*="tenant" i]',
      'input[placeholder*="tenant" i]',
      'input[id*="company" i]',
      'input[name*="company" i]',
      'input[placeholder*="company" i]',
    ],
    role.companyId,
  );

  const emailFilled = await fillFirstVisible(
    page,
    [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]',
    ],
    role.email,
  );

  expect(emailFilled, `${role.name} email field should be found`).toBeTruthy();

  const passwordFilled = await fillFirstVisible(
    page,
    [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]',
      'input[placeholder*="password" i]',
    ],
    role.password,
  );

  expect(passwordFilled, `${role.name} password field should be found`).toBeTruthy();

  await clickLoginButton(page);

  await expect(page).toHaveURL(role.expectedUrl, {
    timeout: 30000,
  });

  const bodyText = await page.locator('body').innerText({
    timeout: 15000,
  });

  expect(bodyText.trim().length).toBeGreaterThan(0);
  expect(pageErrors, `${role.name} dashboard should not throw page errors`).toEqual([]);
}

test.describe('BexHR authenticated role smoke tests', () => {
  for (const role of roles) {
    test(`${role.name} can log in and reach the correct dashboard`, async ({ page }) => {
      test.skip(
        !role.email || !role.password,
        `Missing ${role.name} test credentials in environment variables.`,
      );

      await loginAs(page, role);
    });
  }

  test('Admin dashboard exposes key admin control areas after login', async ({ page }) => {
    const adminRole = roles.find((role) => role.name === 'Admin');

    test.skip(
      !adminRole.email || !adminRole.password,
      'Missing Admin test credentials in environment variables.',
    );

    await loginAs(page, adminRole);

    await expect(page.locator('#adminTabTenantsBtn')).toHaveCount(1);

    await page.evaluate(() => document.getElementById('adminTabTenantsBtn')?.click());

    await expect(page.locator('#tenantRecordsHeader')).toHaveCount(1);
    await expect(page.locator('#adminEmailSetupCompanyId')).toHaveCount(1);
    await expect(page.locator('#profileTenantLinksHeader')).toHaveCount(1);
    await expect(page.locator('#clearAdminEmailHistoryBtn')).toHaveCount(1);
  });
});
