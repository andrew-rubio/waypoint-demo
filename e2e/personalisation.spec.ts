import { test, expect } from '@playwright/test';
import { AuditPanel } from './pages/audit.page';
import { ChatPage } from './pages/chat.page';

/**
 * FRD-006 personalisation via Cosmos DB — INC-6.
 *
 * The agent enriches its answers with the synthetic "John Doe" profile stored in
 * Azure Cosmos DB and retrieved via the `waypoint-data` MCP: reward-programme
 * membership, Gold
 * Tier + reward points, past trips, and travel preferences (aisle seat, vegetarian
 * meal). Personalisation is explained, visible in the audit trail, echoed at the
 * simulated booking, and degrades gracefully when the store is unavailable.
 */
const PERSONALISE = 'Where should I go for a warm coastal break?';
const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';

test.describe('Personalisation via Cosmos DB (FRD-006) @flow:personalisation @frd:FRD-006', () => {
  test('destination suggestions are personalised from the traveller profile (AC-006-1) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(PERSONALISE);

    await expect(chat.personalisationNote).toBeVisible();
    await expect(chat.personalisationNote).toContainText(/Gold Tier/i);
    await expect(chat.personalisationNote).toContainText(/aisle|vegetarian|Portugal|reward points/i);
    await expect(chat.personalisationNote).toContainText(/because|since/i);
    await expect(chat.destinationList).toBeVisible();
  });

  test('the personalisation note reflects the reward points balance (FR-006-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(PERSONALISE);

    await expect(chat.personalisationNote).toContainText('7,463');
    await expect(chat.personalisationNote).toContainText(/reward points/i);
  });

  test('saved preferences are not announced at the flight-search stage (AC-006-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(SEARCH_LISBON);
    await expect(chat.flightOptions).toBeVisible();

    await expect(chat.personalisationNote).not.toBeVisible();
  });

  test('preferred airlines are ranked first and labelled at flight search (FR-006-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(SEARCH_LISBON);
    await expect(chat.flightOptions).toBeVisible();

    await expect(page.getByTestId('preferred-badge').first()).toBeVisible();
    await expect(page.getByTestId('flight-option-0')).toContainText(/British Airways|Vueling/i);
  });

  test('the booking confirmation echoes seat, meal and reward points earned (AC-006-5) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(SEARCH_LISBON);
    await expect(chat.flightOptions).toBeVisible();
    await chat.send('Book the first flight and the first hotel.');

    await expect(chat.bookingConfirmation).toBeVisible();
    await expect(chat.bookingConfirmation).toContainText(/aisle|seat \d{1,2}[A-F]/i);
    await expect(chat.bookingConfirmation).toContainText(/vegetarian/i);
    await expect(chat.bookingConfirmation).toContainText(/amend/i);
    await expect(chat.bookingConfirmation).toContainText('39302492');
    await expect(chat.bookingConfirmation).toContainText(/reward points/i);
    await expect(chat.bookingConfirmation).toContainText(/simulation|demo/i);
  });

  test('Cosmos activity is visible in the audit trail with no secret leak (AC-006-4/FR-006-5)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send(PERSONALISE);
    await expect(chat.personalisationNote).toBeVisible();

    await audit.open();
    const cosmos = audit.entriesOfType('mcp').filter({ hasText: 'cosmos' });
    await expect(cosmos.first()).toHaveAttribute('data-status', 'ok');
    await expect(audit.panel).not.toContainText(/[A-Z]*KEY=|bearer |secret/i);
  });

  test('Cosmos unavailable degrades gracefully (AC-006-3)', async ({ page }) => {
    const chat = new ChatPage(page);
    await page.goto('/?fault=cosmos-error');

    await chat.send(PERSONALISE);

    await expect(chat.errorNotice).toContainText('Personalised data is unavailable right now');
    await expect(chat.input).toBeEnabled();
    await expect(chat.destinationList).toBeVisible();
    await expect(chat.personalisationNote).not.toContainText(/Gold Tier|7,463/i);
  });
});
