import { setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber';
import { type Browser, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import { ChatPage } from '../../../e2e/pages/chat.page';

export interface WorldParameters {
  webBaseURL: string;
  apiBaseURL: string;
}

/**
 * Shared Cucumber World: holds the Playwright browser/page, the ChatPage POM,
 * an API request context, and a counter of user messages sent this scenario.
 * Populated by hooks.ts. Runs against the Aspire environment.
 */
export class CustomWorld extends World<WorldParameters> {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  request!: APIRequestContext;
  chat!: ChatPage;
  sent = 0;

  constructor(options: IWorldOptions<WorldParameters>) {
    super(options);
  }

  get webBaseURL(): string {
    return this.parameters.webBaseURL;
  }

  get apiBaseURL(): string {
    return this.parameters.apiBaseURL;
  }
}

setWorldConstructor(CustomWorld);
