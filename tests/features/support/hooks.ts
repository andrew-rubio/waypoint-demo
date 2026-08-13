import { Before, After, BeforeAll, AfterAll, setDefaultTimeout, Status } from '@cucumber/cucumber';
import { chromium, request, type Browser } from '@playwright/test';
import { type CustomWorld } from './world';

setDefaultTimeout(30_000);

let browser: Browser;

BeforeAll(async function () {
  // Assumes the Aspire environment is already running (aspire start + wait).
  browser = await chromium.launch();
});

AfterAll(async function () {
  await browser?.close();
});

Before(async function (this: CustomWorld) {
  this.browser = browser;
  this.context = await browser.newContext({ reducedMotion: 'reduce' });
  this.page = await this.context.newPage();
  this.request = await request.newContext({ baseURL: this.apiBaseURL });
});

After(async function (this: CustomWorld, scenario) {
  if (scenario.result?.status === Status.FAILED && this.page) {
    const shot = await this.page.screenshot();
    this.attach(shot, 'image/png');
  }
  await this.request?.dispose();
  await this.context?.close();
});
