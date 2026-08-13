import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { type CustomWorld } from '../support/world';
import { ChatPage } from '../../../e2e/pages/chat.page';

// Shared steps reused across chat scenarios. Real Playwright interactions —
// red until the Web app + agent runtime exist.

Given('the traveller has opened Waypoint', async function (this: CustomWorld) {
  this.chat = new ChatPage(this.page);
  this.sent = 0;
  await this.page.goto(this.webBaseURL);
  await expect(this.chat.header).toBeVisible();
});

Given('the chat is on the welcome screen', async function (this: CustomWorld) {
  await expect(this.chat.welcome).toBeVisible();
});

When('the traveller sends {string}', async function (this: CustomWorld, message: string) {
  await this.chat.send(message);
  this.sent += 1;
});

When('the traveller types {string}', async function (this: CustomWorld, message: string) {
  await this.chat.type(message);
});

When('the traveller starts a new chat', async function (this: CustomWorld) {
  await this.chat.newChat.click();
});

When('the traveller selects the Waypoint logo', async function (this: CustomWorld) {
  await this.chat.brandHome.click();
});

Then('their message appears in the conversation', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toBeVisible();
});

Then('the send control is disabled', async function (this: CustomWorld) {
  await expect(this.chat.sendButton).toBeDisabled();
});

Then('the welcome screen is shown again', async function (this: CustomWorld) {
  await expect(this.chat.welcome).toBeVisible();
});

Then('the home screen is shown', async function (this: CustomWorld) {
  await expect(this.chat.welcome).toBeVisible();
});

Then('the conversation is cleared', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toHaveCount(0);
});
