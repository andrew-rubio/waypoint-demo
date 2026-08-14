import { test, expect } from '@playwright/test';
import { AuditPanel } from './pages/audit.page';
import { ChatPage } from './pages/chat.page';

/**
 * FRD-005 flight & hotel search + simulated booking (INC-5) — red baseline.
 *
 * These run against the Aspire environment. They exercise the RouteStack
 * sandbox search path (offline deterministic in local/test mode), GBP
 * normalisation via the currency service, and the clearly-simulated
 * booking-simulator. All fail until the agent routes travel-search / booking
 * turns and the Web app renders flight-options / hotel-options /
 * booking-confirmation.
 */

const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';

test.describe('Flight & hotel search + simulated booking (FRD-005) @flow:search-booking @frd:FRD-005', () => {
  test('search returns flight and hotel options priced in GBP (AC-005-1) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(SEARCH_LISBON);

    await expect(chat.flightOptions).toBeVisible();
    const flights = chat.flightOptions.getByTestId(/^flight-option-/);
    expect(await flights.count()).toBeGreaterThanOrEqual(1);
    expect(await flights.count()).toBeLessThanOrEqual(3);
    await expect(chat.flightOption(0)).toContainText('£');

    await expect(chat.hotelOptions).toBeVisible();
    const hotels = chat.hotelOptions.getByTestId(/^hotel-option-/);
    expect(await hotels.count()).toBeGreaterThanOrEqual(1);
    expect(await hotels.count()).toBeLessThanOrEqual(3);
    await expect(chat.hotelOption(0)).toContainText('£');
  });

  test('at most one flight and one hotel are marked as the best choice (FR-005-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(SEARCH_LISBON);

    await expect(chat.flightOptions).toBeVisible();
    expect(await chat.flightOptions.getByTestId('best-badge').count()).toBeLessThanOrEqual(1);
    expect(await chat.hotelOptions.getByTestId('best-badge').count()).toBeLessThanOrEqual(1);
  });

  test('a missing departure city is requested before searching (AC-005-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send('Find flights and hotels to Lisbon for 2 travellers, outbound 2026-10-14 returning 2026-10-21.');

    const reply = chat.assistantMessage(1);
    await expect(reply).toContainText(/departure city|where.*flying from|which airport|leaving from/i);
    await expect(chat.flightOptions).toHaveCount(0);
    await expect(chat.hotelOptions).toHaveCount(0);
  });

  test('selecting options produces a clearly-simulated booking confirmation (AC-005-3) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send(SEARCH_LISBON);
    await expect(chat.flightOptions).toBeVisible();

    await chat.send('Book the first flight and the first hotel.');

    await expect(chat.bookingConfirmation).toBeVisible();
    await expect(chat.bookingConfirmation).toContainText(/simulation|demo/i);
    await expect(chat.bookingConfirmation).toContainText(/ref/i);
  });

  test('no availability is explained with a suggestion to adjust (AC-005-4)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send('Find flights and hotels to Faro from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.');

    const reply = chat.assistantMessage(1);
    await expect(reply).toContainText(/no availability|no.*results|couldn'?t find/i);
    await expect(reply).toContainText(/adjust|different dates|another destination/i);
    await expect(chat.flightOptions).toHaveCount(0);
  });

  test('travel search is grounded in RouteStack MCP calls in the audit trail (FR-005-7)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send(SEARCH_LISBON);
    await expect(chat.flightOptions).toBeVisible();

    await audit.open();
    const mcp = audit.entriesOfType('mcp');
    await expect(mcp.filter({ hasText: 'routestack.flights' })).toHaveAttribute('data-status', 'ok');
    await expect(mcp.filter({ hasText: 'routestack.hotels' })).toHaveAttribute('data-status', 'ok');
  });

  test('a travel search failure degrades gracefully without crashing (Flow 7)', async ({ page }) => {
    const chat = new ChatPage(page);
    await page.goto('/?fault=routestack-error');

    await chat.send(SEARCH_LISBON);

    await expect(chat.errorNotice).toContainText('Travel search is unavailable right now');
    await expect(chat.input).toBeEnabled();
    await expect(chat.flightOptions).toHaveCount(0);
  });
});
