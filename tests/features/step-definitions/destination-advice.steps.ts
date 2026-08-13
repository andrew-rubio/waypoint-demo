import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { AuditPanel } from '../../../e2e/pages/audit.page';
import { ChatPage } from '../../../e2e/pages/chat.page';
import { type CustomWorld } from '../support/world';

type DestinationScenarioState = {
  previousNames: string[];
  selectedName?: string;
};

const scenarioState = new WeakMap<CustomWorld, DestinationScenarioState>();

function state(world: CustomWorld): DestinationScenarioState {
  let current = scenarioState.get(world);
  if (!current) {
    current = { previousNames: [] };
    scenarioState.set(world, current);
  }
  return current;
}

function audit(world: CustomWorld): AuditPanel {
  return new AuditPanel(world.page);
}

async function finishTurn(world: CustomWorld): Promise<void> {
  await expect(world.chat.assistantMessage((world.sent - 1) * 2 + 1)).toBeVisible();
  await expect(world.page.getByTestId('streaming-caret')).toBeHidden();
}

async function askForDestinations(world: CustomWorld, interests: string): Promise<void> {
  await world.chat.send(`Suggest destinations for ${interests}`);
  world.sent += 1;
  await finishTurn(world);
}

async function sendRequest(world: CustomWorld, request: string): Promise<void> {
  await world.chat.send(request);
  world.sent += 1;
  await finishTurn(world);
}

async function destinationNames(world: CustomWorld): Promise<string[]> {
  return world.chat.destinationList.getByRole('heading', { level: 4 }).allTextContents();
}

Given('the Traveller is on the Waypoint welcome screen', async function (this: CustomWorld) {
  this.chat = new ChatPage(this.page);
  this.sent = 0;
  scenarioState.set(this, { previousNames: [] });
  await this.page.goto(this.webBaseURL);
  await expect(this.chat.welcome).toBeVisible();
});

Given('the Traveller received a destination list for {string}', async function (this: CustomWorld, interests: string) {
  await askForDestinations(this, interests);
  await expect(this.chat.destinationList).toBeVisible();
  state(this).previousNames = await destinationNames(this);
});

Given('the destination advisor will fail', async function (this: CustomWorld) {
  await this.page.goto(`${this.webBaseURL}/?fault=destination-advisor-error`);
  await expect(this.chat.header).toBeVisible();
});

When('the Traveller asks for destinations with {string}', async function (this: CustomWorld, interests: string) {
  await askForDestinations(this, interests);
});

When('the Traveller asks to {string}', async function (this: CustomWorld, request: string) {
  await sendRequest(this, request);
});

When('the Traveller asks for {string}', async function (this: CustomWorld, request: string) {
  await sendRequest(this, request);
});

When('the Traveller asks for options that are {string}', async function (this: CustomWorld, request: string) {
  await sendRequest(this, request);
});

When('the Traveller asks for a destination with {string}', async function (this: CustomWorld, request: string) {
  await sendRequest(this, request);
});

When('the Traveller asks {string}', async function (this: CustomWorld, request: string) {
  await sendRequest(this, request);
});

When('the Traveller chooses the first destination', async function (this: CustomWorld) {
  const first = this.chat.destinationItem(0);
  state(this).selectedName = (await first.getByRole('heading').innerText()).trim();
  await first.getByRole('button', { name: /explore/i }).click();
});

When('the Traveller opens the audit trail', async function (this: CustomWorld) {
  await audit(this).open();
});

Then('a destination list should contain between 3 and 5 ranked suggestions', async function (this: CustomWorld) {
  const count = await this.chat.destinationList.getByTestId(/^destination-item-/).count();
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(5);
});

Then("every destination should have a rationale tied to the Traveller's interests", async function (this: CustomWorld) {
  const items = this.chat.destinationList.getByTestId(/^destination-item-/);
  for (let index = 0; index < await items.count(); index += 1) {
    await expect(items.nth(index)).toContainText(/warm|hiking|seafood/i);
  }
});

Then('every destination should include descriptive tags', async function (this: CustomWorld) {
  const items = this.chat.destinationList.getByTestId(/^destination-item-/);
  for (let index = 0; index < await items.count(); index += 1) {
    await expect(items.nth(index).getByTestId(/^tag-/).first()).toBeVisible();
  }
});

Then('the agent should ask exactly one focused travel-preference question', async function (this: CustomWorld) {
  const reply = await this.chat.assistantMessage((this.sent - 1) * 2 + 1).innerText();
  expect(reply.match(/\?/g)).toHaveLength(1);
  expect(reply).toMatch(/climate|budget|activity|beach|city/i);
});

Then('no destination list should be shown', async function (this: CustomWorld) {
  await expect(this.chat.destinationList).toHaveCount(0);
});

Then('the destination list should be updated', async function (this: CustomWorld) {
  const currentNames = await destinationNames(this);
  expect(currentNames).not.toEqual(state(this).previousNames);
});

Then('the updated suggestions should reflect affordability and beach access', async function (this: CustomWorld) {
  await expect(this.chat.destinationList).toContainText(/cheap|afford|budget/i);
  await expect(this.chat.destinationList).toContainText(/beach|coast/i);
});

Then('every suggested destination should include a city or region and country', async function (this: CustomWorld) {
  const names = await destinationNames(this);
  expect(names.length).toBeGreaterThanOrEqual(3);
  for (const name of names) expect(name).toMatch(/^[^,]+, [^,]+$/);
});

Then('the chosen destination should retain its canonical place name', async function (this: CustomWorld) {
  const selectedName = state(this).selectedName;
  expect(selectedName).toBeDefined();
  await expect(this.chat.destinationItem(0).getByRole('heading')).toHaveText(selectedName!);
});

Then('the agent should acknowledge the conflicting interests', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage((this.sent - 1) * 2 + 1)).toContainText(/conflict|tension|different directions/i);
});

Then('the agent should offer options for each interpretation', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage((this.sent - 1) * 2 + 1)).toContainText(/hot|warm/i);
  await expect(this.chat.assistantMessage((this.sent - 1) * 2 + 1)).toContainText(/snow|cold/i);
});

Then('the agent should explain that there is no strong match', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage((this.sent - 1) * 2 + 1)).toContainText(/no (strong|exact|perfect) match/i);
});

Then('the agent should suggest the closest alternatives', async function (this: CustomWorld) {
  await expect(this.chat.destinationList).toBeVisible();
  await expect(this.chat.destinationList.getByTestId(/^destination-item-/).first()).toBeVisible();
});

Then('the agent should gently steer the conversation back to trip planning', async function (this: CustomWorld) {
  await expect(this.chat.assistantMessage((this.sent - 1) * 2 + 1)).toContainText(/trip|travel|holiday/i);
});

Then('the Traveller should see {string}', async function (this: CustomWorld, message: string) {
  await expect(this.chat.errorNotice).toContainText(message);
});

Then('the conversation should remain usable', async function (this: CustomWorld) {
  await expect(this.chat.input).toBeEnabled();
});

Then('the audit trail should contain an error entry for the destination advisor', async function (this: CustomWorld) {
  await audit(this).open();
  const entry = audit(this).entriesOfType('skill').filter({ hasText: 'destination-advisor' });
  await expect(entry).toHaveAttribute('data-status', 'error');
});

Then('the audit trail should contain a successful skill entry named {string}', async function (this: CustomWorld, name: string) {
  const entry = audit(this).entriesOfType('skill').filter({ hasText: name });
  await expect(entry).toHaveAttribute('data-status', 'ok');
});

Then("the skill entry should summarise the Traveller's interests and ranked result", async function (this: CustomWorld) {
  const entry = audit(this).entriesOfType('skill').filter({ hasText: 'destination-advisor' });
  await expect(entry).toContainText(/warm|hiking|seafood/i);
  await expect(entry).toContainText(/[3-5] ranked/i);
});