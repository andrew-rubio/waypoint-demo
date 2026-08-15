import { test, expect } from '@playwright/test';
import { AuditPanel } from './pages/audit.page';
import { ChatPage } from './pages/chat.page';

/**
 * FRD-007 trip summary, budget & currency — INC-7.
 *
 * Once flights and hotels have been shown, the agent assembles a trip summary
 * with a budget breakdown ((flight × party) + (nightly × nights × rooms)),
 * labels taxes/fees, reflects the Cosmos preferences + reward points, and shows
 * the total in EUR on request (rate + timestamp in the audit trail). It degrades
 * gracefully when currency conversion or personalisation is unavailable.
 */
const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';
const SUMMARISE = 'Can you summarise the trip and total cost?';

async function showSummary(page: import('@playwright/test').Page): Promise<ChatPage> {
  const chat = new ChatPage(page);
  await chat.goto();
  await chat.send(SEARCH_LISBON);
  await expect(chat.flightOptions).toBeVisible();
  await chat.send(SUMMARISE);
  await expect(chat.tripSummaryCard).toBeVisible();
  return chat;
}

test.describe('Trip summary, budget & currency (FRD-007) @flow:trip-summary @frd:FRD-007', () => {
  test('the trip summary shows the itinerary and a GBP budget breakdown (AC-007-1) @smoke', async ({ page }) => {
    const chat = await showSummary(page);

    await expect(chat.tripSummaryCard).toContainText(/Lisbon/i);
    await expect(chat.budgetBreakdown).toBeVisible();
    await expect(chat.totalAmount).toContainText('£');
    await expect(chat.budgetBreakdown).toContainText(/excl.*tax|excludes taxes/i);
  });

  test('the summary shows applied preferences and the reward points balance (AC-007-3)', async ({ page }) => {
    const chat = await showSummary(page);

    await expect(chat.preferenceNote).toContainText(/aisle/i);
    await expect(chat.preferenceNote).toContainText(/vegetarian/i);
    await expect(chat.preferenceNote).toContainText('7,463');
  });

  test('the summariser and budget estimator are visible in the audit trail (FR-007-6)', async ({ page }) => {
    const chat = await showSummary(page);
    const audit = new AuditPanel(page);

    await audit.open();
    await expect(audit.entriesOfType('skill').filter({ hasText: 'trip-summariser' }).first()).toHaveAttribute('data-status', 'ok');
    await expect(audit.entriesOfType('skill').filter({ hasText: 'budget-estimator' }).first()).toHaveAttribute('data-status', 'ok');
  });

  test('the total can be shown in euros with the rate in the audit trail (AC-007-2) @smoke', async ({ page }) => {
    const chat = await showSummary(page);
    const audit = new AuditPanel(page);

    await chat.send('show that in euros');
    await expect(chat.tripSummaryCard).toContainText('€');

    await audit.open();
    const entry = audit.entriesOfType('mcp').filter({ hasText: 'currency.convert' }).first();
    await expect(entry).toHaveAttribute('data-status', 'ok');
    const detail = await audit.expandFirstOfType('mcp');
    await expect(detail).toContainText(/rate/i);
  });

  test('currency conversion failure falls back to GBP (error handling)', async ({ page }) => {
    const chat = await showSummary(page);
    const audit = new AuditPanel(page);

    // Fail only the next turn: inject the fault without reloading the conversation.
    await page.evaluate(() => window.history.replaceState(null, '', '/?fault=currency-error'));
    await chat.send('show that in euros');

    await expect(chat.tripSummaryCard).toContainText('£');
    await expect(chat.tripSummaryCard).not.toContainText('€');
    await expect(chat.input).toBeEnabled();

    await audit.open();
    await expect(audit.entriesOfType('mcp').filter({ hasText: 'currency' }).first()).toHaveAttribute('data-status', 'error');
  });

  test('the summary omits preferences and points when personalisation is unavailable (degraded)', async ({ page }) => {
    const chat = new ChatPage(page);
    await page.goto('/?fault=summary-no-personalisation');

    await chat.send(SUMMARISE);

    await expect(chat.tripSummaryCard).toBeVisible();
    await expect(chat.totalAmount).toContainText('£');
    await expect(chat.preferenceNote).not.toBeVisible();
    await expect(chat.tripSummaryCard).not.toContainText('7,463');
  });

  test('booking auto-shows the trip summary above the confirmation (AC-007-1) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.send(SEARCH_LISBON);
    await expect(chat.flightOptions).toBeVisible();

    await chat.send('Book the first flight and the first hotel.');

    // Both cards appear automatically, with the summary (blue) above the confirmation (green).
    await expect(chat.tripSummaryCard).toBeVisible();
    await expect(chat.bookingConfirmation).toBeVisible();
    const summaryBox = await chat.tripSummaryCard.boundingBox();
    const bookingBox = await chat.bookingConfirmation.boundingBox();
    expect(summaryBox && bookingBox && summaryBox.y < bookingBox.y).toBeTruthy();
  });
});
