import { test, expect } from '@playwright/test';
import { ChatPage } from './pages/chat.page';
import { AuditPanel } from './pages/audit.page';

/**
 * INC-2 audit-trail e2e flow (source: specs/ui/flow-walkthrough.md Flow 6 +
 * FRD-002). Red until the AuditPanel component + useChat audit state + the
 * `?fault=sample-tools` demo hook exist.
 */
test.describe('Audit trail side panel (FRD-002)', () => {
  test('toggle the panel in and out of view (AC-002-1) @smoke', async ({ page }) => {
    const audit = new AuditPanel(page);
    await new ChatPage(page).goto();

    await expect(audit.panel).toBeHidden();
    await audit.open();
    await expect(audit.panel).toBeVisible();
    await audit.close();
    await expect(audit.panel).toBeHidden();
  });

  test('empty state before any activity', async ({ page }) => {
    const audit = new AuditPanel(page);
    await new ChatPage(page).goto();
    await audit.open();
    await expect(audit.empty).toBeVisible();
  });

  test('a plain conversation records a decision entry (AC-002-3)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send('Where should I go?');
    await expect(chat.assistantMessage(1)).not.toBeEmpty();

    await audit.open();
    await expect(audit.entriesOfType('decision').first()).toBeVisible();
    await expect(audit.entriesOfType('decision').first()).toContainText(/\w/);
  });

  test('the model entry echoes the prompt and the reply text (request/response)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send('Tell me about Lisbon');
    await expect(chat.assistantMessage(1)).not.toBeEmpty();
    const reply = (await chat.assistantMessage(1).innerText()).trim();

    await audit.open();
    const detail = await audit.expandFirstOfType('api');
    await expect(detail).toBeVisible();
    // Request carries the traveller's message; response carries the agent's reply.
    await expect(detail).toContainText('Tell me about Lisbon');
    await expect(detail).toContainText(reply.slice(0, 40));
  });

  test('a tool call resolves from pending to ok with a duration (AC-002-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await page.goto('/?fault=sample-tools');
    await audit.open();
    await chat.send('Find me flights to Lisbon');

    const mcp = audit.entriesOfType('mcp').first();
    await expect(mcp).toBeVisible();
    await expect(mcp).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });
  });

  test('expanding a tool entry reveals redacted detail (AC-002-4, FR-002-4)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await page.goto('/?fault=sample-tools');
    await audit.open();
    await chat.send('Find me flights to Lisbon');
    await expect(audit.entriesOfType('mcp').first()).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });

    const detail = await audit.expandFirstOfType('mcp');
    await expect(detail).toBeVisible();
    // The secret value never reaches the client; a redacted marker shows instead.
    await expect(detail).not.toContainText('super-secret-key-value');
    await expect(detail).toContainText(/redacted/i);
  });

  test('clear empties the trail (AC-002-5)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send('Somewhere sunny please');
    await expect(chat.assistantMessage(1)).not.toBeEmpty();

    await audit.open();
    await expect(audit.entries().first()).toBeVisible();
    await audit.clear();
    await expect(audit.empty).toBeVisible();
    // Clearing the trail does not touch the conversation.
    await expect(chat.userMessage(0)).toBeVisible();
  });

  test('new chat clears the trail (FR-002-9)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send('Tell me about Crete');
    await audit.open();
    await expect(audit.entries().first()).toBeVisible();

    await chat.newChat.click();
    await expect(audit.empty).toBeVisible();
  });

  test('a failed turn renders an error entry, not a crash (AC-002-6) @error', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await page.goto('/?fault=mid-stream-error');
    await audit.open();
    await chat.send('Plan me a trip');

    await expect(audit.list.locator('[data-status="error"]').first()).toBeVisible();
    // The panel is still interactive after an error.
    await expect(audit.clearButton).toBeEnabled();
  });
});
