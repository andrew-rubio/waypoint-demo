import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { AuditPanel } from '../../../e2e/pages/audit.page';
import { type CustomWorld } from '../support/world';

/**
 * FRD-006 personalisation via Cosmos DB step definitions (INC-6).
 *
 * Reuses shared steps from destination-advice.steps.ts / flight-hotel-search-booking.steps.ts:
 *   - "the Traveller is on the Waypoint welcome screen"
 *   - "the Traveller asks {string}"
 *   - "the Traveller says {string}"
 *   - "the Traveller opens the audit trail"
 *   - "the Traveller should see {string}"
 *   - "the conversation should remain usable"
 * Only personalisation-specific setup and assertions live here.
 */

const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';

function audit(world: CustomWorld): AuditPanel {
  return new AuditPanel(world.page);
}

function cosmosEntry(world: CustomWorld) {
  return audit(world).entriesOfType('mcp').filter({ hasText: 'cosmos' }).first();
}

// ── Given: profile / degradation setup ───────────────────────────────

Given('flights and hotels have been shown for a covered destination', async function (this: CustomWorld) {
  await this.chat.send(SEARCH_LISBON);
  this.sent += 1;
  await expect(this.chat.flightOptions).toBeVisible();
  await expect(this.chat.hotelOptions).toBeVisible();
});

Given("the traveller's saved seat preference is an aisle seat", function () {
  // The synthetic John Doe profile defaults to an aisle seat — no setup needed.
});

Given("the traveller's saved preferences are available but the trip history is missing", async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=cosmos-no-history`);
  await expect(this.chat.header).toBeVisible();
});

Given('the Cosmos profile store will fail', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=cosmos-error`);
  await expect(this.chat.header).toBeVisible();
});

// ── When: booking / flight presentation ──────────────────────────────

When('the agent presents the flight options', async function (this: CustomWorld) {
  await expect(this.chat.flightOptions).toBeVisible();
});

When('the Traveller books the first flight and hotel', async function (this: CustomWorld) {
  await this.chat.send('Book the first flight and the first hotel.');
  this.sent += 1;
});

// ── Then: personalisation note ───────────────────────────────────────

Then("the agent should query Cosmos for the traveller's profile", async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toBeVisible();
});

Then("a personalisation note should reference the traveller's Gold Tier status or a past trip", async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/Gold Tier|Portugal|past trip|rated/i);
});

Then('the personalisation note should explain why the suggestions were personalised', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/because|since/i);
});

Then("a personalisation note should mention the traveller's 7,463 reward point balance", async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText('7,463');
  await expect(this.chat.personalisationNote).toContainText(/reward points/i);
});

Then('the reward points balance shown should come from the Cosmos profile, not invented', async function (this: CustomWorld) {
  await audit(this).open();
  await expect(cosmosEntry(this)).toHaveAttribute('data-status', 'ok');
});

Then('a personalisation note should say an aisle seat will be pre-selected', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/aisle/i);
});

Then('the personalisation note should say a vegetarian meal will be pre-selected', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/vegetarian/i);
});

Then('the personalisation note should reference the available preferences', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/aisle|vegetarian/i);
});

Then('the personalisation note should not fabricate any past-destination details', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).not.toContainText(/Portugal|Lisbon|Barcelona|previously|been to/i);
});

Then('the personalisation note should apply a window seat', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/window/i);
});

Then('the personalisation note should acknowledge it differs from the saved preference', async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).toContainText(/instead of|rather than|differs|usually|normally|saved preference/i);
});

Then("no personalisation note should claim to know the traveller's profile", async function (this: CustomWorld) {
  await expect(this.chat.personalisationNote).not.toContainText(/Gold Tier|7,463/i);
});

// ── Then: booking echoes personalisation ─────────────────────────────

Then('the booking confirmation should state an aisle seat assignment', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toBeVisible();
  await expect(this.chat.bookingConfirmation).toContainText(/aisle|seat \d{1,2}[A-F]/i);
});

Then('the booking confirmation should note a vegetarian in-flight meal', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText(/vegetarian/i);
});

Then('the booking confirmation should show the reward points earned on this trip', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText(/earn/i);
  await expect(this.chat.bookingConfirmation).toContainText(/reward points/i);
});

Then("it should reference the traveller's saved membership number", async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText('39302492');
});

Then('it should show the updated reward points balance', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText(/balance/i);
});

Then('the accrual should be presented as a simulation, not a real reservation', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText(/simulation|demo/i);
});

// ── Then: destinations / audit ───────────────────────────────────────

Then('the agent should still suggest destinations from the conversation', async function (this: CustomWorld) {
  await expect(this.chat.destinationList).toBeVisible();
});

Then('the audit trail should contain a successful Cosmos entry of type {string}', async function (this: CustomWorld, type: string) {
  await audit(this).open();
  const entry = audit(this).entriesOfType(type).filter({ hasText: 'cosmos' }).first();
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('the Cosmos entry should summarise its query and a redacted result', async function (this: CustomWorld) {
  const entry = cosmosEntry(this);
  await entry.locator('[data-testid="audit-entry-top"]').click();
  const detail = entry.locator('[data-testid="audit-entry-detail"]');
  await expect(detail).toContainText(/profile|loyalty|preferences|tier/i);
});

Then('no Cosmos credential or secret should appear in the audit trail', async function (this: CustomWorld) {
  await expect(audit(this).panel).not.toContainText(/[A-Z]*KEY=|bearer |secret/i);
});

Then('the audit trail should contain an error entry for the Cosmos profile store', async function (this: CustomWorld) {
  await audit(this).open();
  await expect(cosmosEntry(this)).toHaveAttribute('data-status', 'error');
});
