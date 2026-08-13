import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { type CustomWorld } from '../support/world';
import { AuditPanel } from '../../../e2e/pages/audit.page';

/**
 * FRD-002 audit-trail steps. Reuse the shell POM (this.chat, set by the shared
 * "Given the traveller has opened Waypoint" background step) and a dedicated
 * AuditPanel POM built per step from this.page. Tool/redaction scenarios use the
 * documented `?fault=sample-tools` demo hook, which emits a decision + a
 * server-redacted tool_call/tool_result pair + a streamed reply. Red until the
 * AuditPanel, useChat audit state, and the demo hook exist.
 */
function audit(this: CustomWorld): AuditPanel {
  return new AuditPanel(this.page);
}

/** Load the app with a fault/demo hook applied, then run one turn to completion.
 * Uses a real navigation (not replaceState) because the query must be present
 * when useChat reads it at send time — replaceState proved racy under load. */
async function runTurnWithHook(this: CustomWorld, hook: string, message: string): Promise<void> {
  await this.page.goto(`${this.webBaseURL}/?fault=${hook}`);
  await expect(this.chat.header).toBeVisible();
  await this.chat.send(message);
  // Wait for the reply to arrive, then for streaming to finish, so the audit
  // state is fully populated before the assertions run.
  await expect(this.chat.assistantMessage(1)).not.toBeEmpty({ timeout: 10_000 });
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden({ timeout: 10_000 });
  this.sent += 1;
}

// ── Toggle visibility (AC-002-1) ────────────────────────────────────────
Given('the audit panel is hidden', async function (this: CustomWorld) {
  await audit.call(this).close();
});

Given('the audit panel is open', async function (this: CustomWorld) {
  await audit.call(this).open();
});

When('the presenter opens the audit panel', async function (this: CustomWorld) {
  await audit.call(this).open();
});

When('the presenter closes the audit panel', async function (this: CustomWorld) {
  await audit.call(this).close();
});

Then('the audit panel is visible', async function (this: CustomWorld) {
  await expect(audit.call(this).panel).toBeVisible();
});

// "the audit panel is hidden" is registered once above (Given); Given/Then are
// keyword-agnostic in Cucumber, so it also matches the Then usage.

// ── Conversation context ─────────────────────────────────────────────
Given('the traveller has exchanged a message with the agent', async function (this: CustomWorld) {
  await this.chat.send('Hello, plan me a trip');
  this.sent += 1;
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden();
  await expect(this.chat.assistantMessage(1)).not.toBeEmpty();
});

Given('the traveller has exchanged two messages with the agent', async function (this: CustomWorld) {
  await this.chat.send('First question');
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden();
  await this.chat.send('Second question');
  await expect(this.page.getByTestId('streaming-caret')).toBeHidden();
  await expect(this.chat.assistantMessage(3)).not.toBeEmpty();
  this.sent = 2;
});

Then('the conversation is unchanged', async function (this: CustomWorld) {
  await expect(this.chat.userMessage(0)).toBeVisible();
});

// ── Empty state ─────────────────────────────────────────────────────────
Given('there has been no agent activity yet', async function (this: CustomWorld) {
  await expect(audit.call(this).entries()).toHaveCount(0);
});

Then('the audit panel shows an empty state', async function (this: CustomWorld) {
  await expect(audit.call(this).empty).toBeVisible();
});

// ── Decision entries (AC-002-3) ─────────────────────────────────────────
Then('an audit entry of type {string} appears', async function (this: CustomWorld, type: string) {
  await expect(audit.call(this).entriesOfType(type).first()).toBeVisible({ timeout: 10_000 });
});

Then('the decision entry reads as human-readable text', async function (this: CustomWorld) {
  await expect(audit.call(this).entriesOfType('decision').first()).toContainText(/[a-z]{3,}/i);
});

Then('no audit entry contains hidden model reasoning', async function (this: CustomWorld) {
  const text = ((await audit.call(this).list.innerText()) || '').toLowerCase();
  expect(text).not.toContain('chain_of_thought');
  expect(text).not.toContain('chain of thought');
  expect(text).not.toContain('"reasoning"');
});

// ── Tool lifecycle (AC-002-2) ───────────────────────────────────────────
Given('the presenter runs a turn that calls a tool', async function (this: CustomWorld) {
  await runTurnWithHook.call(this, 'sample-tools', 'Find me flights to Lisbon');
});

Then('that entry resolves to a status of {string} with a duration', async function (this: CustomWorld, status: string) {
  const entry = audit.call(this).entriesOfType('mcp').first();
  await expect(entry).toHaveAttribute('data-status', status, { timeout: 10_000 });
  await expect(entry.getByTestId('audit-duration')).toContainText(/\d/);
});

// ── Turn grouping (FR-002-2) ────────────────────────────────────────────
Then('the audit trail shows two turn groups', async function (this: CustomWorld) {
  await expect(audit.call(this).turnGroups()).toHaveCount(2);
});

// ── Truncation / expand (FR-002-4) ──────────────────────────────────────
When('the presenter expands the tool entry', async function (this: CustomWorld) {
  await audit.call(this).expandFirstOfType('mcp');
});

Then('the entry reveals its request and response detail', async function (this: CustomWorld) {
  const detail = audit.call(this).entriesOfType('mcp').first().getByTestId('audit-entry-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(/request/i);
  await expect(detail).toContainText(/response/i);
});

// ── Redaction (AC-002-4) ────────────────────────────────────────────────
Given('the presenter runs a turn whose tool call carries an API key', async function (this: CustomWorld) {
  await runTurnWithHook.call(this, 'sample-tools', 'Find me flights to Lisbon');
});

Then('the API key value is not shown', async function (this: CustomWorld) {
  const detail = audit.call(this).entriesOfType('mcp').first().getByTestId('audit-entry-detail');
  await expect(detail).not.toContainText('super-secret-key-value');
});

Then('the entry shows a redacted placeholder in its place', async function (this: CustomWorld) {
  const detail = audit.call(this).entriesOfType('mcp').first().getByTestId('audit-entry-detail');
  await expect(detail).toContainText(/redacted/i);
});

// ── Clear (AC-002-5) ────────────────────────────────────────────────────
When('the presenter clears the audit trail', async function (this: CustomWorld) {
  await audit.call(this).clear();
});

// ── Error entry, not a crash (AC-002-6) ─────────────────────────────────
When('a turn fails partway through', async function (this: CustomWorld) {
  await runTurnWithHook.call(this, 'mid-stream-error', 'Plan me a trip');  // The navigation above resets UI state, so re-open the panel the scenario
  // established as its precondition.
  await audit.call(this).open();});

Then('an audit entry with a status of {string} appears', async function (this: CustomWorld, status: string) {
  await expect(audit.call(this).list.locator(`[data-status="${status}"]`).first()).toBeVisible({ timeout: 10_000 });
});

Then('the audit panel keeps functioning', async function (this: CustomWorld) {
  await expect(audit.call(this).clearButton).toBeEnabled();
});
