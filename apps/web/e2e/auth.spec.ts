import { test, expect } from '@playwright/test';

/**
 * Login form error DOM (login-form.tsx):
 *   <p className="text-sm text-red-600 dark:text-red-400" role="alert">{message}</p>
 * Prefer class/text selectors over getByRole('alert') for CI stability.
 */
function loginError(page: import('@playwright/test').Page) {
  return page.locator('form p.text-red-600, form p[role="alert"]');
}

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/api key/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('login with empty API key shows validation error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill('');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Server action returns "API key is required" into the red error paragraph
    await expect(loginError(page)).toContainText(/required/i, { timeout: 15_000 });
  });

  test('login with invalid API key shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill('invalid-key-12345678');
    await page.getByRole('button', { name: /sign in/i }).click();
    // validateApiKey failure → "Invalid API key. Check your credentials..."
    await expect(loginError(page)).toContainText(/invalid|unauthorized|error/i, {
      timeout: 15_000,
    });
  });

  test('login with valid API key redirects to dashboard', async ({ page }) => {
    test.skip(!process.env.E2E_API_KEY, 'E2E_API_KEY not configured');
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill(process.env.E2E_API_KEY!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('logout redirects to login page', async ({ page }) => {
    test.skip(!process.env.E2E_API_KEY, 'E2E_API_KEY not configured');
    await page.goto('/login');
    await page.getByLabel(/api key/i).fill(process.env.E2E_API_KEY!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL('/dashboard/settings');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL('/login');
  });
});
