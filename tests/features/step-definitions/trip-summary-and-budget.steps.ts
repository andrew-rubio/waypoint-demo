import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { AuditPanel } from '../../../e2e/pages/audit.page';
import { type CustomWorld } from '../support/world';

/**
 * FRD-007 trip summary, budget & currency step definitions (INC-7).
 *
 * Reuses shared steps from destination-advice / flight-hotel-search-booking /
 * personalisation:
 *   - "the Traveller is on the Waypoint welcome screen"
 *   - "the Traveller asks {string}"
 *   - "the Traveller says {string}"
 *   - "the Traveller opens the audit trail"
 *   - "flights and hotels have been shown for a covered destination"
 *   - "the audit trail should contain a successful skill entry named {string}"
 *   - "the audit trail should contain a successful currency conversion entry"
 *   - "the currency conversion entry should record the exchange rate and a rate timestamp"
 * Only summary/budget/currency-specific setup and assertions live here.
 */

const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';
const SUMMARISE = 'Can you summarise the trip and total cost?';

function audit(world: CustomWorld): AuditPanel {
  return new AuditPanel(world.page);
}

async function amount(world: CustomWorld, testId: string): Promise<number> {
  const text = await world.page.getByTestId(testId).innerText();
  return Number(text.replace(/[^0-9.]/g, ''));
}

// ── Given: summary / degradation setup ───────────────────────────────

Given('a trip summary with a GBP total has been shown', async function (this: CustomWorld) {
  await this.chat.send(SEARCH_LISBON);
  this.sent += 1;
  await expect(this.chat.flightOptions).toBeVisible();
  await this.chat.send(SUMMARISE);
  this.sent += 1;
  await expect(this.chat.tripSummaryCard).toBeVisible();
});

Given('a flight has been selected but no hotel', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=summary-flight-only`);
  await expect(this.chat.header).toBeVisible();
});

Given('the Cosmos profile store is unavailable', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=summary-no-personalisation`);
  await expect(this.chat.header).toBeVisible();
});

Given('the currency service is unavailable', async function (this: CustomWorld) {
  // Fault only the next turn — inject without reloading so the shown summary survives.
  await this.page.evaluate(() => window.history.replaceState(null, '', '/?fault=currency-error'));
});

// ── Then: summary card ───────────────────────────────────────────────

Then('a trip summary card should show the destination and travel dates', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toBeVisible();
  await expect(this.chat.tripSummaryCard).toContainText(/Lisbon/i);
  await expect(this.chat.tripSummaryCard).toContainText(/Oct|2026/i);
});

Then('it should show the selected flight and hotel', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toContainText(/flight|→|LIS/i);
  await expect(this.chat.tripSummaryCard).toContainText(/hotel|★|night/i);
});

Then('it should show the party size, number of nights and room count', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toContainText(/2 travellers|party/i);
  await expect(this.chat.tripSummaryCard).toContainText(/7 nights/i);
  await expect(this.chat.tripSummaryCard).toContainText(/1 room/i);
});

Then('it should show the flight and hotel budget line items', async function (this: CustomWorld) {
  await expect(this.chat.budgetBreakdown).toBeVisible();
  await expect(this.page.getByTestId('budget-line-flight')).toBeVisible();
  await expect(this.page.getByTestId('budget-line-hotel')).toBeVisible();
});

Then('it should show an estimated total in GBP', async function (this: CustomWorld) {
  await expect(this.chat.totalAmount).toContainText('£');
});

Then('the estimated total should equal the flight and hotel line items combined', async function (this: CustomWorld) {
  const flight = await amount(this, 'budget-line-flight');
  const hotel = await amount(this, 'budget-line-hotel');
  const total = await amount(this, 'total-amount');
  expect(total).toBe(flight + hotel);
});

Then('the booking confirmation should be shown below the trip summary', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toBeVisible();
  const summaryBox = await this.chat.tripSummaryCard.boundingBox();
  const bookingBox = await this.chat.bookingConfirmation.boundingBox();
  expect(Boolean(summaryBox && bookingBox && summaryBox.y < bookingBox.y)).toBe(true);
});

Then('the estimated total should be labelled as excluding unspecified taxes and fees', async function (this: CustomWorld) {
  await expect(this.chat.budgetBreakdown).toContainText(/exclud.*tax|excl.*fees|not specified/i);
});

Then('the summary should note the aisle seat and vegetarian meal are pre-selected', async function (this: CustomWorld) {
  await expect(this.chat.preferenceNote).toContainText(/aisle/i);
  await expect(this.chat.preferenceNote).toContainText(/vegetarian/i);
});

Then("the summary should show the traveller's 7,463 reward point balance", async function (this: CustomWorld) {
  await expect(this.chat.preferenceNote).toContainText('7,463');
  await expect(this.chat.preferenceNote).toContainText(/reward points/i);
});

// ── Then: currency (EUR) ─────────────────────────────────────────────

Then('the summary should show the total in EUR alongside the GBP total', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toContainText('€');
  await expect(this.chat.totalAmount).toContainText('£');
});

Then('the agent should call the currency service to convert GBP to EUR', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'currency.convert' }).first();
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('the summary should remain in GBP', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toContainText('£');
  await expect(this.chat.tripSummaryCard).not.toContainText('€');
});

Then('the agent should note that conversion to EUR is unavailable', async function (this: CustomWorld) {
  await expect(this.chat.errorNotice).toContainText(/EUR|euro|convert/i);
});

Then('the audit trail should contain an error entry for the currency service', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'currency' }).first();
  await expect(entry).toHaveAttribute('data-status', 'error');
});

// ── Then: partial selection ──────────────────────────────────────────

Then('the summary should show the selected flight and the total so far', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toBeVisible();
  await expect(this.chat.tripSummaryCard).toContainText(/flight|→|LIS/i);
  await expect(this.chat.totalAmount).toContainText('£');
});

Then('it should note that no hotel is selected', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toContainText(/no hotel|hotel.*not.*selected|without a hotel/i);
});

// ── Then: nothing to summarise ───────────────────────────────────────

Then('the agent should explain there is nothing to summarise yet', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('message-list')).toContainText(/nothing to summarise/i);
});

Then('it should prompt the Traveller to choose a destination, flight and hotel', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('message-list')).toContainText(/destination|flight|hotel|search/i);
});

// ── Then: personalisation degraded ───────────────────────────────────

Then('the summary should still show the itinerary and estimated total', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toBeVisible();
  await expect(this.chat.totalAmount).toContainText('£');
});

Then('it should not show a pre-selected seat or meal', async function (this: CustomWorld) {
  await expect(this.chat.preferenceNote).not.toBeVisible();
});

Then('it should note that personalisation is unavailable', async function (this: CustomWorld) {
  await expect(this.chat.tripSummaryCard).toContainText(/personalisation.*unavailable|without.*personal|couldn.t.*profile/i);
});
