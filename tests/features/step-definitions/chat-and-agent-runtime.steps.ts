import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { type CustomWorld } from '../support/world';

/**
 * FRD-001 feature-specific steps. Fault paths use a documented test-mode hook:
 * opening the app with `?fault=<kind>` instructs the agent runtime (in test/demo
 * mode only) to simulate a failure. This defines the contract the Implementation
 * Agent must honour. Red until the Web app + agent runtime exist.
 */

async function openWithFault(this: CustomWorld, kind: string): Promise<void> {
  await this.page.goto(`${this.webBaseURL}/?fault=${kind}`);
  await expect(this.chat.header).toBeVisible();
}

// ── Streaming (AC-001-1) ────────────────────────────────────────────────
Then('an assistant reply appears and fills in progressively', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage(1)).toBeVisible();
  await expect(this.page.getByTestId('streaming-caret')).toBeVisible();
});

Then('the reply finishes completely', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden();
  await expect(this.chat.assistantMessage(1)).not.toBeEmpty();
});

// ── Empty / whitespace (AC-001-2) ───────────────────────────────────────
When('the message box is empty', async function (this: CustomWorld) {
  await this.chat.input.fill('');
});

When('the traveller tries to send a message containing only spaces', async function (this: CustomWorld) {
  await this.chat.input.fill('   ');
  await this.chat.input.press('Enter');
});

Then('no message is added to the conversation', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toHaveCount(0);
});

Then('no reply is generated', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage(1)).toHaveCount(0);
});

// ── Ordering (AC-001-3) ─────────────────────────────────────────────────
Given('the traveller has already exchanged two messages with the agent', async function (this: CustomWorld) {
  await this.chat.send('First question');
  await expect(this.chat.assistantMessage(1)).toBeVisible();
  await this.chat.send('Second question');
  await expect(this.chat.assistantMessage(3)).toBeVisible();
  this.sent = 2;
});

Then('all messages appear in the order they were sent', async function (this: CustomWorld) {
  const first = await this.chat.userMessage(0).boundingBox();
  // Global indexing: user bubbles sit at even indices (0, 2, 4, …); the newest
  // user message is therefore at (sent - 1) * 2.
  const later = await this.chat.userMessage((this.sent - 1) * 2).boundingBox();
  expect(first && later && later.y > first.y).toBeTruthy();
});

Then("the traveller's messages and the agent's replies are visually distinct", async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toBeVisible();
  await expect(this.chat.assistantMessage(1)).toBeVisible();
});

// ── Composer (FR-001-2) ─────────────────────────────────────────────────
Given('the traveller has typed {string}', async function (this: CustomWorld, text: string) {
  await this.chat.input.fill(text);
});

When('the traveller presses Enter', async function (this: CustomWorld) {
  await this.chat.input.press('Enter');
});

When('the traveller presses Shift and Enter', async function (this: CustomWorld) {
  await this.chat.input.press('Shift+Enter');
});

Then('the message is sent', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toBeVisible();
});

Then('a new line is added to the message box', async function (this: CustomWorld) {
  await expect(this.chat.input).toHaveValue(/\n/);
});

Then('the message is not sent', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toHaveCount(0);
});

// ── Observable decision, no hidden reasoning (AC-001-4) ──────────────────
Then('the agent records at least one observable decision before the reply text begins', async function (this: CustomWorld) {
  const res = await this.request.post('/api/chat', {
    data: { sessionId: 'bdd-decision', message: 'Where should I go?' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  const decisionAt = body.indexOf('"type":"decision"');
  const tokenAt = body.indexOf('"type":"token"');
  expect(decisionAt).toBeGreaterThanOrEqual(0);
  expect(decisionAt).toBeLessThan(tokenAt === -1 ? Number.MAX_SAFE_INTEGER : tokenAt);
});

Then('the recorded activity contains no hidden model reasoning', async function (this: CustomWorld) {
  const res = await this.request.post('/api/chat', {
    data: { sessionId: 'bdd-noreason', message: 'Where should I go?' },
  });
  const body = (await res.text()).toLowerCase();
  expect(body).not.toContain('chain_of_thought');
  expect(body).not.toContain('"reasoning"');
});

// ── Mid-stream error (AC-001-5) ─────────────────────────────────────────
Given('the traveller has sent a message and the agent has started replying', async function (this: CustomWorld) {
  await openWithFault.call(this, 'mid-stream-error');
  await this.chat.send('Plan me a trip');
});

When('the agent\'s reply fails partway through', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toBeVisible();
});

Then('the traveller sees a non-blocking error notice', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toBeVisible();
});

Then('the earlier messages remain in the conversation', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toBeVisible();
});

// ── New chat / session reset (AC-001-6) ─────────────────────────────────
Given('the traveller has an ongoing conversation with several messages', async function (this: CustomWorld) {
  await this.chat.send('One');
  await this.chat.send('Two');
  this.sent = 2;
});

Given('the traveller is in an ongoing conversation', async function (this: CustomWorld) {
  await this.chat.send('Tell me about Lisbon');
  this.sent = 1;
});

Then('the next message begins a fresh session', async function (this: CustomWorld) {
  await this.chat.send('Fresh start');
  await expect(this.chat.userMessage(0)).toBeVisible();
});

// ── Concurrency edge case ───────────────────────────────────────────────
Given('the traveller has sent a message and the agent is still replying', async function (this: CustomWorld) {
  await openWithFault.call(this, 'slow-reply');
  await this.chat.send('Plan me a trip');
});

When('the traveller tries to send another message', async function (this: CustomWorld) {
  await this.chat.input.fill('Another message');
});

Then('the send control is unavailable until the current reply finishes', async function (this: CustomWorld) {
  await expect(this.chat.sendButton).toBeDisabled();
});

// ── Long message ────────────────────────────────────────────────────────
When('the traveller sends a message longer than four thousand characters', async function (this: CustomWorld) {
  await this.chat.send('x'.repeat(4100));
  this.sent += 1;
});

Then('the message is accepted', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toBeVisible();
});

Then('the traveller is told if the message was shortened for the agent', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('truncation-notice')).toBeVisible();
});

// ── Refresh ─────────────────────────────────────────────────────────────
When('the traveller refreshes the browser', async function (this: CustomWorld) {
  await this.page.reload();
});

Then('a new empty conversation is shown', async function (this: CustomWorld) {
  await expect(this.chat.welcome).toBeVisible();
  await expect(this.chat.userMessage(0)).toHaveCount(0);
});

// ── Connection drop ─────────────────────────────────────────────────────
Given('the agent is in the middle of replying', async function (this: CustomWorld) {
  await openWithFault.call(this, 'slow-reply');
  await this.chat.send('Plan me a trip');
});

When('the connection is lost', async function (this: CustomWorld) {
  await this.context.setOffline(true);
});

Then('the traveller is told the connection was lost', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toContainText(/connection/i);
});

Then('the partial reply so far remains visible', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage(1)).toBeVisible();
});

// ── New chat mid-reply ──────────────────────────────────────────────────
Then('the in-progress reply is cancelled', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden();
});

Then('a fresh conversation is shown', async function (this: CustomWorld) {
  await expect(this.chat.welcome).toBeVisible();
  await expect(this.chat.userMessage(0)).toHaveCount(0);
});

// ── Error handling ──────────────────────────────────────────────────────
Given('the agent runtime cannot start', async function (this: CustomWorld) {
  await openWithFault.call(this, 'agent-unavailable');
});

Then('the traveller sees a message that the agent is unavailable', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toContainText(/unavailable/i);
});

Then('the traveller is invited to try again', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toContainText(/try again/i);
});

Given('the agent cannot reach a model', async function (this: CustomWorld) {
  await openWithFault.call(this, 'model-unavailable');
});

Given('the agent does not respond within the allowed time', async function (this: CustomWorld) {
  await openWithFault.call(this, 'timeout');
});

Then('the reply attempt stops', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden();
});

Then('the traveller sees a timeout notice and can resend', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toContainText(/tim(ed)? ?out/i);
  await expect(this.chat.sendButton).toBeEnabled();
});
