import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Waypoint chat shell.
 * Selectors are the stable data-testid values defined in
 * specs/ui/component-inventory.md. The Implementation Agent (INC-1) must
 * render these testids for the e2e + BDD suites to go green.
 */
export class ChatPage {
  readonly page: Page;
  readonly header: Locator;
  readonly brandHome: Locator;
  readonly newChat: Locator;
  readonly auditToggle: Locator;
  readonly messageList: Locator;
  readonly welcome: Locator;
  readonly composer: Locator;
  readonly input: Locator;
  readonly sendButton: Locator;
  readonly errorNotice: Locator;

  constructor(page: Page) {
    this.page = page;
    this.header = page.getByTestId('app-header');
    this.brandHome = page.getByTestId('brand-home');
    this.newChat = page.getByTestId('new-chat');
    this.auditToggle = page.getByTestId('audit-toggle');
    this.messageList = page.getByTestId('message-list');
    this.welcome = page.getByTestId('welcome');
    this.composer = page.getByTestId('composer');
    this.input = page.getByTestId('composer-input');
    this.sendButton = page.getByTestId('send-button');
    this.errorNotice = page.getByTestId('error-notice');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async type(text: string): Promise<void> {
    await this.input.fill(text);
  }

  async send(text: string): Promise<void> {
    await this.input.fill(text);
    await this.input.press('Enter');
  }

  userMessage(index: number): Locator {
    return this.page.getByTestId(`message-user-${index}`);
  }

  assistantMessage(index: number): Locator {
    return this.page.getByTestId(`message-assistant-${index}`);
  }

  async expectSendDisabled(): Promise<void> {
    await expect(this.sendButton).toBeDisabled();
  }
}
