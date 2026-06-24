import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly sidebar: Locator;

  constructor(private page: Page) {
    this.sidebar = page.locator('.app-sidebar');
  }

  async goto() {
    await this.page.goto('/dashboard');
  }

  menuItem(title: string): Locator {
    return this.sidebar.getByText(title);
  }

  async hasMenu(title: string): Promise<boolean> {
    return this.menuItem(title).isVisible().catch(() => false);
  }
}
