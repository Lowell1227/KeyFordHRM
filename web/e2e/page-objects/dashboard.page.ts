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
    return this.sidebar.locator('.menu-link', { hasText: title });
  }

  groupTitle(title: string): Locator {
    return this.sidebar.locator('.menu-group__title', { hasText: title });
  }

  railItem(title: string): Locator {
    return this.sidebar.locator('.app-rail .rail-item', { hasText: title });
  }

  navigationModules(): Locator {
    return this.sidebar.locator('[data-testid^="nav-module-"]');
  }

  module(key: string): Locator {
    return this.sidebar.getByTestId(`nav-module-${key}`);
  }

  async openModule(key: string) {
    await this.module(key).click();
  }

  async hasMenu(title: string): Promise<boolean> {
    return this.menuItem(title).isVisible().catch(() => false);
  }
}
