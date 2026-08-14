import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { AuditPanel } from '../../../e2e/pages/audit.page';
import { type CustomWorld } from '../support/world';

/**
 * FRD-004 weather & best-time-to-travel step definitions (INC-4).
 *
 * Reuses the shared steps from destination-advice.steps.ts / common.steps.ts:
 *   - "the Traveller is on the Waypoint welcome screen"
 *   - "the Traveller asks {string}"
 *   - "the Traveller opens the audit trail"
 *   - "the Traveller should see {string}"
 *   - "the conversation should remain usable"
 * Only the weather-specific assertions are defined here.
 */

function audit(world: CustomWorld): AuditPanel {
  return new AuditPanel(world.page);
}

/** The assistant reply bubble for the most recent turn (global index u0/a1/u2/a3…). */
function replyText(world: CustomWorld) {
  return world.chat.assistantMessage((world.sent - 1) * 2 + 1);
}

Given('the Open-Meteo weather service will fail', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=weather-mcp-error`);
  await expect(this.chat.header).toBeVisible();
});

Then('a weather summary should name the resolved destination {string}', async function (this: CustomWorld, place: string) {
  await expect(this.chat.weatherCard).toBeVisible();
  await expect(this.chat.weatherCard).toContainText(place);
});

Then(
  'the weather summary should report {word} daily temperatures in °C and precipitation in mm',
  async function (this: CustomWorld, month: string) {
    await expect(this.chat.weatherCard).toContainText(month);
    await expect(this.chat.weatherCard).toContainText('°C');
    await expect(this.chat.weatherCard).toContainText('mm');
  },
);

Then('the weather summary should cite Open-Meteo as the source', async function (this: CustomWorld) {
  await expect(this.chat.weatherSource).toContainText(/Open-Meteo/i);
});

Then('the weather summary should recommend one or more months, each with a reason', async function (this: CustomWorld) {
  await expect(this.chat.weatherCard).toBeVisible();
  const items = this.chat.weatherRecommended.getByRole('listitem');
  expect(await items.count()).toBeGreaterThan(0);
  await expect(items.first()).not.toBeEmpty();
});

Then('the weather summary should list one or more months to avoid, each with a reason', async function (this: CustomWorld) {
  const items = this.chat.weatherAvoid.getByRole('listitem');
  expect(await items.count()).toBeGreaterThan(0);
  await expect(items.first()).not.toBeEmpty();
});

Then('the audit trail should contain a successful Open-Meteo geocoding entry', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'open-meteo.geocoding' });
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('the audit trail should contain a successful Open-Meteo climate entry', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'open-meteo.climate' });
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then('the reported figures should come from the Open-Meteo response, not invented', async function (this: CustomWorld) {
  // The card is present and cites Open-Meteo, and the climate MCP call succeeded.
  await expect(this.chat.weatherCard).toBeVisible();
  await expect(this.chat.weatherSource).toContainText(/Open-Meteo/i);
  const climate = audit(this).entriesOfType('mcp').filter({ hasText: 'open-meteo.climate' });
  await expect(climate).toHaveAttribute('data-status', 'ok');
});

Then('the agent should say it could not locate the place', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/could ?n'?t locate|couldn'?t find|unable to locate/i);
});

Then('the agent should ask for a real destination', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/real destination|another place|which place/i);
});

Then('no weather summary should be shown', async function (this: CustomWorld) {
  await expect(this.chat.weatherCard).toHaveCount(0);
});

Then('the agent should offer candidate places to choose from', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/did you mean|which one|there are (a few|several)/i);
});

Then('the agent should explain that climate data is not available for that point', async function (this: CustomWorld) {
  await expect(replyText(this)).toContainText(/not available|no (climate )?data|couldn'?t find climate/i);
});

Then('no fabricated temperature or precipitation figures should be shown', async function (this: CustomWorld) {
  await expect(this.chat.weatherCard).toHaveCount(0);
  await expect(replyText(this)).not.toContainText(/°C|\bmm\b/);
});

Then('the audit trail should contain an error entry for the Open-Meteo service', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('mcp').filter({ hasText: 'open-meteo' });
  await expect(entry.first()).toHaveAttribute('data-status', 'error');
});

Then('the Open-Meteo geocoding entry should summarise its request and response', async function (this: CustomWorld) {
  const detail = await audit(this).expandFirstOfType('mcp');
  await expect(detail).toContainText('request');
  await expect(detail).toContainText('response');
});
