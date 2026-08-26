import type { Page, Locator } from '@playwright/test';

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
    return this.sidebar.locator('.rail-item[data-testid^="nav-module-"]');
  }

  module(key: string): Locator {
    return this.sidebar.getByTestId(`nav-module-${key}`);
  }

  currentEmployeeTask(): Locator {
    return this.page.getByTestId('employee-current-task');
  }

  currentEmployeeTaskOpen(): Locator {
    return this.page.getByTestId('employee-current-task-open');
  }

  managerGoalReviewCount(): Locator {
    return this.page.getByTestId('manager-goal-review-count');
  }

  managerGoalReviewOpen(): Locator {
    return this.page.getByTestId('manager-goal-review-open');
  }

  managerPersonalTask(): Locator {
    return this.page.getByTestId('manager-personal-task');
  }

  managerGoalReviewCard(): Locator {
    return this.page.getByTestId('manager-goal-review-card');
  }

  managerEvaluationCard(): Locator {
    return this.page.getByTestId('manager-evaluation-card');
  }

  managerEvaluationCount(): Locator {
    return this.page.getByTestId('manager-evaluation-count');
  }

  managementTaskOpen(taskId: string): Locator {
    return this.page.getByTestId(`dashboard-task-open-${taskId}`);
  }

  async openModule(key: string) {
    const module = this.module(key);
    await module.click();
    await this.sidebar
      .locator(`.rail-item[data-testid="nav-module-${key}"].is-active`)
      .waitFor();
  }

  async hasMenu(title: string): Promise<boolean> {
    return this.menuItem(title).isVisible().catch(() => false);
  }
}
