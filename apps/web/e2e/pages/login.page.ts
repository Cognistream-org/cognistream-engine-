import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for /login.
 * Auth uses Next.js Server Actions (POST to /login), not a /v1/auth REST endpoint.
 * Invalid keys trigger a server-side call to GET /v1/agents?limit=1 from the Next server.
 */
export class LoginPage {
  readonly page: Page;
  readonly apiKeyInput: Locator;
  readonly submitButton: Locator;
  readonly heading: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.apiKeyInput = page.getByLabel(/api key/i);
    this.submitButton = page.getByRole('button', { name: /sign in/i });
    this.heading = page.getByRole('heading', { name: /sign in/i });
    this.errorAlert = page.locator('form p.text-red-600, form p[role="alert"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
    await expect(this.heading).toBeVisible();
    await expect(this.apiKeyInput).toBeVisible();
    await expect(this.submitButton).toBeEnabled();
  }

  /**
   * Wait for the Next.js server-action POST that backs loginAction.
   * Matches RSC/action flight responses to /login (or current path).
   */
  waitForLoginActionResponse() {
    return this.page.waitForResponse((response) => {
      if (response.request().method() !== 'POST') return false;
      const url = response.url();
      if (!url.includes('/login')) return false;
      // Next.js server actions set Next-Action; also accept plain form POSTs.
      const headers = response.request().headers();
      return (
        Boolean(headers['next-action']) ||
        Boolean(headers['content-type']?.includes('multipart/form-data')) ||
        Boolean(headers['content-type']?.includes('application/x-www-form-urlencoded')) ||
        Boolean(headers['content-type']?.includes('text/plain'))
      );
    });
  }

  async submitEmpty(): Promise<void> {
    await this.apiKeyInput.fill('');
    const action = this.waitForLoginActionResponse();
    await this.submitButton.click();
    await action;
  }

  async submitApiKey(apiKey: string): Promise<void> {
    await this.apiKeyInput.fill(apiKey);
    const action = this.waitForLoginActionResponse();
    await this.submitButton.click();
    await action;
  }

  async expectValidationError(pattern: RegExp): Promise<void> {
    await expect(this.errorAlert).toBeVisible();
    await expect(this.errorAlert).toContainText(pattern);
  }
}
