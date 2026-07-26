import { test, expect } from '@playwright/test';

const apiKey = process.env.E2E_API_KEY || 'cs_demo_e2e_key_000000000000';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill(apiKey);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('sidebar navigation works for all routes', async ({ page }) => {
    const routes = [
      { label: /agents/i, path: '/dashboard/agents' },
      { label: /transactions/i, path: '/dashboard/transactions' },
      { label: /api keys/i, path: '/dashboard/api-keys' },
      { label: /settings/i, path: '/dashboard/settings' },
    ];

    for (const route of routes) {
      await page.getByRole('link', { name: route.label }).click();
      await expect(page).toHaveURL(route.path);
    }
  });

  test('overview page displays stat cards', async ({ page }) => {
    await page.goto('/dashboard/overview');
    await expect(page.getByText(/transactions this month/i)).toBeVisible();
    await expect(page.getByText(/volume this month/i)).toBeVisible();
    await expect(page.getByText(/active agents/i)).toBeVisible();
    await expect(page.getByText(/org balance/i)).toBeVisible();
  });

  test('agents page displays table or empty state', async ({ page }) => {
    await page.goto('/dashboard/agents');
    await expect(
      page.getByRole('table').or(page.getByText(/no agents yet/i)),
    ).toBeVisible();
  });
});
