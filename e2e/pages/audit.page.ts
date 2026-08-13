import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Audit Trail side panel (FRD-002, INC-2).
 * Selectors are the stable data-testid values in specs/ui/component-inventory.md.
 * Entries additionally expose `data-type` and `data-status` attributes so tests
 * can assert type/lifecycle without parsing display text.
 */
export class AuditPanel {
  readonly page: Page;
  readonly toggle: Locator;
  readonly panel: Locator;
  readonly header: Locator;
  readonly list: Locator;
  readonly empty: Locator;
  readonly clearButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.toggle = page.getByTestId('audit-toggle');
    this.panel = page.getByTestId('audit-panel');
    this.header = page.getByTestId('audit-panel-header');
    this.list = page.getByTestId('audit-list');
    this.empty = page.getByTestId('audit-empty');
    this.clearButton = page.getByTestId('audit-clear');
  }

  /** All rendered entries, regardless of type. */
  entries(): Locator {
    return this.list.locator('[data-testid^="audit-entry-"]');
  }

  /** Entries of a given audit type (decision | skill | mcp | api). */
  entriesOfType(type: string): Locator {
    return this.list.locator(`[data-testid^="audit-entry-"][data-type="${type}"]`);
  }

  /** Per-turn group containers. */
  turnGroups(): Locator {
    return this.list.locator('[data-testid^="audit-turn-"]');
  }

  async isOpen(): Promise<boolean> {
    return (await this.toggle.getAttribute('aria-pressed')) === 'true';
  }

  async open(): Promise<void> {
    if (!(await this.isOpen())) await this.toggle.click();
    await expect(this.panel).toBeVisible();
  }

  async close(): Promise<void> {
    if (await this.isOpen()) await this.toggle.click();
    await expect(this.panel).toBeHidden();
  }

  async clear(): Promise<void> {
    await this.clearButton.click();
  }

  /** Expand the first entry of a type to reveal its request/response detail. */
  async expandFirstOfType(type: string): Promise<Locator> {
    const entry = this.entriesOfType(type).first();
    await entry.waitFor({ state: 'visible' });
    await entry.locator('[data-testid="audit-entry-top"]').click();
    const detail = entry.locator('[data-testid="audit-entry-detail"]');
    await detail.waitFor({ state: 'visible' });
    return detail;
  }
}
