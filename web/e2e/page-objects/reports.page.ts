import { Page, Locator } from '@playwright/test';

export class ReportsPage {
  readonly tabs: Locator;

  constructor(private page: Page) {
    this.tabs = page.locator('.el-tabs__nav');
  }

  async goto() {
    await this.page.goto('/reports');
  }

  tab(name: string): Locator {
    return this.tabs.getByText(name);
  }

  async hasTab(name: string): Promise<boolean> {
    return this.tab(name).isVisible().catch(() => false);
  }
}
