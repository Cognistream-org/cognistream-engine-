import { test, expect } from '@playwright/test';

const apiKey = process.env.E2E_API_KEY;
if (!apiKey) {
  throw new Error('E2E_API_KEY environment variable is required for e2e tests');
}

test.describe('Transactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill(apiKey);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('transactions page shows table with data or empty state', async ({ page }) => {
    await page.goto('/dashboard/transactions');
    await expect(
      page.getByRole('table').or(page.getByText(/no transactions match/i)),
    ).toBeVisible();
  });

  test('can navigate to transaction detail', async ({ page }) => {
    await page.goto('/dashboard/transactions');
    const firstLink = page.locator('table tbody tr:first-child a').first();
    if (await firstLink.isVisible().catch(() => false)) {
      await firstLink.click();
      await expect(page).toHaveURL(/\/dashboard\/transactions\/.+/);
      await expect(page.getByText(/status/i).first()).toBeVisible();
    }
  });
});
