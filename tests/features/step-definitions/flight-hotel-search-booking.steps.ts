import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { AuditPanel } from '../../../e2e/pages/audit.page';
import { type CustomWorld } from '../support/world';

/**
 * FRD-005 flight & hotel search + simulated booking step definitions (INC-5).
 *
 * Reuses shared steps from destination-advice.steps.ts / common.steps.ts:
 *   - "the Traveller is on the Waypoint welcome screen"
 *   - "the Traveller opens the audit trail"
 *   - "the Traveller should see {string}"
 *   - "the conversation should remain usable"
 * Only search/booking-specific setup and assertions live here.
 */

type TripSetup = {
  destination?: string;
  origin?: string;
  party?: number;
  outbound?: string;
  return?: string;
};

const VALID_OUTBOUND = '2026-10-14';
const VALID_RETURN = '2026-10-21';

const tripState = new WeakMap<CustomWorld, TripSetup>();

function trip(world: CustomWorld): TripSetup {
  let current = tripState.get(world);
  if (!current) {
    current = {};
    tripState.set(world, current);
  }
  return current;
}

function audit(world: CustomWorld): AuditPanel {
  return new AuditPanel(world.page);
}

/** The assistant reply bubble for the most recent turn (global index u0/a1/u2/a3…). */
function replyText(world: CustomWorld) {
  return world.chat.assistantMessage((world.sent - 1) * 2 + 1);
}

function searchMessage(setup: TripSetup): string {
  const destination = setup.destination ?? 'Lisbon';
  const party = setup.party ?? 2;
  const outbound = setup.outbound ?? VALID_OUTBOUND;
  const ret = setup.return ?? VALID_RETURN;
  const from = setup.origin ? ` from ${setup.origin}` : '';
  return `Find flights and hotels to ${destination}${from} for ${party} travellers, outbound ${outbound} returning ${ret}.`;
}

async function sendSearch(world: CustomWorld): Promise<void> {
  await world.chat.send(searchMessage(trip(world)));
  world.sent += 1;
}

// ── Given: trip context ──────────────────────────────────────────────

Given(
  'the Traveller has chosen {string} with valid dates and a party of {int} departing from {word}',
  function (this: CustomWorld, destination: string, party: number, origin: string) {
    tripState.set(this, { destination, party, origin, outbound: VALID_OUTBOUND, return: VALID_RETURN });
  },
);

Given(
  'the Traveller has chosen {string} with valid dates and a party of {int} and no known departure city',
  function (this: CustomWorld, destination: string, party: number) {
    tripState.set(this, { destination, party, origin: undefined, outbound: VALID_OUTBOUND, return: VALID_RETURN });
  },
);

Given(
  'the Traveller has chosen {string} departing from {word} with valid dates and a party of {int}',
  function (this: CustomWorld, destination: string, origin: string, party: number) {
    tripState.set(this, { destination, origin, party, outbound: VALID_OUTBOUND, return: VALID_RETURN });
  },
);

Given(
  'the Traveller has chosen {string} departing from {word} with dates in the past',
  function (this: CustomWorld, destination: string, origin: string) {
    tripState.set(this, { destination, origin, party: 2, outbound: '2020-01-14', return: '2020-01-21' });
  },
);

Given(
  'the Traveller has chosen {string} departing from {word} with a return date before the outbound date',
  function (this: CustomWorld, destination: string, origin: string) {
    tripState.set(this, { destination, origin, party: 2, outbound: '2026-10-21', return: '2026-10-14' });
  },
);

Given(
  'the Traveller has chosen a destination and dates with no available inventory in the sandbox',
  function (this: CustomWorld) {
    tripState.set(this, { destination: 'Faro', origin: 'London', party: 2, outbound: VALID_OUTBOUND, return: VALID_RETURN });
  },
);

Given('the Traveller has chosen a destination that the sandbox does not cover', function (this: CustomWorld) {
  tripState.set(this, { destination: 'Timbuktu', origin: 'London', party: 2, outbound: VALID_OUTBOUND, return: VALID_RETURN });
});

Given('the flight supplier quotes prices in EUR', function () {
  // The deterministic Lisbon sandbox inventory is quoted in EUR by default, so
  // the GBP normalisation path is exercised without extra setup.
});

Given('the Traveller has been shown flight and hotel options for {word}', async function (this: CustomWorld, destination: string) {
  tripState.set(this, { destination, origin: 'London', party: 2, outbound: VALID_OUTBOUND, return: VALID_RETURN });
  await sendSearch(this);
  await expect(this.chat.flightOptions).toBeVisible();
  await expect(this.chat.hotelOptions).toBeVisible();
});

Given('the RouteStack travel search service will fail', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=routestack-error`);
  await expect(this.chat.header).toBeVisible();
});

Given('the RouteStack sandbox search quota has been reached', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=routestack-quota`);
  await expect(this.chat.header).toBeVisible();
});

Given('the booking simulation will fail', async function (this: CustomWorld) {
  // Activate the booking-only fault without reloading, so the already-shown
  // options and session survive and only the next booking turn fails.
  await this.page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('fault', 'booking-error');
    window.history.pushState({}, '', url);
  });
});

// ── When: search / booking turns ─────────────────────────────────────

When('the Traveller asks to find flights and hotels', async function (this: CustomWorld) {
  await sendSearch(this);
});

When('the Traveller asks to find flights and hotels for {word}', async function (this: CustomWorld, destination: string) {
  const setup = trip(this);
  setup.destination = destination;
  setup.origin = setup.origin ?? 'London';
  await sendSearch(this);
});

When('the Traveller says {string}', async function (this: CustomWorld, message: string) {
  await this.chat.send(message);
  this.sent += 1;
});

// ── Then: option lists ───────────────────────────────────────────────

Then(
  'a flight options list should contain between {int} and {int} options',
  async function (this: CustomWorld, min: number, max: number) {
    await expect(this.chat.flightOptions).toBeVisible();
    const count = await this.chat.flightOptions.getByTestId(/^flight-option-/).count();
    expect(count).toBeGreaterThanOrEqual(min);
    expect(count).toBeLessThanOrEqual(max);
  },
);

Then(
  'a hotel options list should contain between {int} and {int} options',
  async function (this: CustomWorld, min: number, max: number) {
    await expect(this.chat.hotelOptions).toBeVisible();
    const count = await this.chat.hotelOptions.getByTestId(/^hotel-option-/).count();
    expect(count).toBeGreaterThanOrEqual(min);
    expect(count).toBeLessThanOrEqual(max);
  },
);

Then('every flight option should show its airline, route, duration, stops, and a price in GBP', async function (this: CustomWorld) {
  const items = this.chat.flightOptions.getByTestId(/^flight-option-/);
  for (let index = 0; index < (await items.count()); index += 1) {
    await expect(items.nth(index)).toContainText(/\d+h|\d+\s?hr|stop|nonstop|direct/i);
    await expect(items.nth(index)).toContainText('£');
  }
});

Then('every hotel option should show its name, rating, and nightly rate in GBP', async function (this: CustomWorld) {
  const items = this.chat.hotelOptions.getByTestId(/^hotel-option-/);
  for (let index = 0; index < (await items.count()); index += 1) {
    await expect(items.nth(index)).toContainText('£');
  }
});

Then('any taxes or fees inclusion should be labelled', async function (this: CustomWorld) {
  await expect(this.chat.hotelOptions.first()).toContainText(/tax|fee|include/i);
});

Then('at most one flight option should be marked as the best choice', async function (this: CustomWorld) {
  expect(await this.chat.flightOptions.getByTestId('best-badge').count()).toBeLessThanOrEqual(1);
});

Then('at most one hotel option should be marked as the best choice', async function (this: CustomWorld) {
  expect(await this.chat.hotelOptions.getByTestId('best-badge').count()).toBeLessThanOrEqual(1);
});

Then('every displayed price should be shown in GBP', async function (this: CustomWorld) {
  await expect(this.chat.flightOption(0)).toContainText('£');
  await expect(this.chat.hotelOption(0)).toContainText('£');
});

Then('no flight options list should be shown', async function (this: CustomWorld) {
  await expect(this.chat.flightOptions).toHaveCount(0);
});

Then('no hotel options list should be shown', async function (this: CustomWorld) {
  await expect(this.chat.hotelOptions).toHaveCount(0);
});

// ── Then: clarifications and validations ─────────────────────────────

Then('the agent should ask for the departure city', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/departure city|flying from|leaving from|which airport/i);
});

Then('the agent should explain that there is no availability', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/no availability|no.*results|couldn'?t find/i);
});

Then('the agent should suggest adjusting the dates or destination', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/adjust|different dates|another (destination|city)/i);
});

Then('the agent should flag that the dates are not valid', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/not valid|invalid|in the past|past date/i);
});

Then('the agent should ask for valid travel dates', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/valid.*dates|different dates|future date/i);
});

Then('the agent should point out that the return is before the outbound date', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/return.*before.*outbound|return.*earlier|before you leave/i);
});

Then('the agent should ask the Traveller to correct the dates', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/correct.*dates|fix.*dates|adjust.*dates/i);
});

Then('the agent should explain that demo coverage is limited', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/demo coverage|limited coverage|sandbox.*cover|not covered/i);
});

Then('the agent should suggest a covered city', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/try|instead|such as|for example|covered/i);
});

Then('the agent should clarify or cap the party size', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/party size|how many|group|travellers|maximum/i);
});

Then('the agent should continue with a supported party size', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/travellers|people|party/i);
});

// ── Then: simulated booking ──────────────────────────────────────────

Then('a booking confirmation should be shown with a reference code', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toBeVisible();
  await expect(this.chat.bookingConfirmation).toContainText(/ref/i);
});

Then('the booking confirmation should echo the chosen flight and hotel itinerary', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText(/Lisbon/);
});

Then('the booking confirmation should be clearly marked as a demo simulation', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toContainText(/simulation|demo/i);
});

Then('no payment should be taken', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation.getByRole('link', { name: /pay|checkout/i })).toHaveCount(0);
  await expect(this.chat.bookingConfirmation).not.toContainText(/payment (taken|required|received)|enter card/i);
});

Then('no booking confirmation should be shown', async function (this: CustomWorld) {
  await expect(this.chat.bookingConfirmation).toHaveCount(0);
});

// ── Then: quota / retry ──────────────────────────────────────────────

Then('the search should not be retried', async function (this: CustomWorld) {
  await audit(this).open();
  const routestack = audit(this).entriesOfType('mcp').filter({ hasText: 'routestack' });
  expect(await routestack.count()).toBeLessThanOrEqual(1);
});

// ── Then: audit trail ────────────────────────────────────────────────

Then('the audit trail should contain a successful currency conversion entry', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'currency.convert' });
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('the currency conversion entry should record the exchange rate and a rate timestamp', async function (this: CustomWorld) {
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'currency.convert' });
  await entry.locator('[data-testid="audit-entry-top"]').click();
  const detail = entry.locator('[data-testid="audit-entry-detail"]');
  await expect(detail).toContainText(/rate/i);
});

Then('the audit trail should contain a successful RouteStack flight search entry', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'routestack.flights' });
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('the audit trail should contain a successful RouteStack hotel search entry', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'routestack.hotels' });
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('each RouteStack entry should summarise its request and response', async function (this: CustomWorld) {
  const detail = await audit(this).expandFirstOfType('mcp');
  await expect(detail).toContainText('request');
  await expect(detail).toContainText('response');
});

Then('the audit trail should contain an error entry for the RouteStack service', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'routestack' });
  await expect(entry.first()).toHaveAttribute('data-status', 'error');
});

Then('the audit trail should contain an error entry for the booking simulation', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('skill').filter({ hasText: 'booking-simulator' });
  await expect(entry.first()).toHaveAttribute('data-status', 'error');
});
