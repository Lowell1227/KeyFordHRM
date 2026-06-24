import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly employeeNoInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly dingtalkButton: Locator;

  constructor(private page: Page) {
    this.employeeNoInput = page.locator('[data-testid="login-employee-no"]');
    this.passwordInput = page.locator('[data-testid="login-password"]');
    this.submitButton = page.locator('[data-testid="login-submit"]');
    this.dingtalkButton = page.locator('[data-testid="dingtalk-login"]');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async loginWithPassword(employeeNo: string, password: string) {
    await this.employeeNoInput.fill(employeeNo);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await this.page.waitForURL(/\/dashboard$/, { timeout: 10000 });
  }

  async loginWithDingtalk() {
    await this.dingtalkButton.click();
  }
}
