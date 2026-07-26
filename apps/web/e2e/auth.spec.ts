import { test, expect } from '@playwright/test';

const apiKey = process.env.E2E_API_KEY || 'cs_demo_e2e_key_000000000000';

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/api key/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('login with empty API key shows validation error', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/required/i);
  });

  test('login with invalid API key shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill('invalid-key-12345678');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid/i);
  });

  test('login with valid API key redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill(apiKey);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('logout redirects to login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill(apiKey);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL('/dashboard/settings');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL('/login');
  });
});
