import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/login.page';

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(login.apiKeyInput).toBeVisible();
    await expect(login.submitButton).toBeVisible();
    await expect(login.heading).toBeVisible();
  });

  test('login with empty API key shows validation error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.submitEmpty();
    // loginAction returns synchronously: "API key is required"
    await login.expectValidationError(/required/i);
  });

  test('login with invalid API key shows error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    // Server action POSTs /login; Next then validates via GET /v1/agents?limit=1
    await login.submitApiKey('invalid-key-12345678');
    await login.expectValidationError(/invalid/i);
  });

  test('login with valid API key redirects to dashboard', async ({ page }) => {
    test.skip(!process.env.E2E_API_KEY, 'E2E_API_KEY not configured');
    const login = new LoginPage(page);
    await login.goto();
    await login.submitApiKey(process.env.E2E_API_KEY!);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('logout redirects to login page', async ({ page }) => {
    test.skip(!process.env.E2E_API_KEY, 'E2E_API_KEY not configured');
    const login = new LoginPage(page);
    await login.goto();
    await login.submitApiKey(process.env.E2E_API_KEY!);
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL('/dashboard/settings');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL('/login');
  });
});
