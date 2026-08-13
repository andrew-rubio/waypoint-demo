import { test, expect } from '@playwright/test';
import { AuditPanel } from './pages/audit.page';
import { ChatPage } from './pages/chat.page';

test.describe('Destination advice (FRD-003) @flow:destination-advice @frd:FRD-003', () => {
  test('interests produce a ranked destination shortlist (AC-003-1) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send('I love warm weather, hiking, and good seafood');

    await expect(chat.destinationList).toBeVisible();
    const destinations = chat.destinationList.getByTestId(/^destination-item-/);
    await expect(destinations).toHaveCount(3);
    await expect(chat.destinationItem(0)).toContainText(/warm|hiking|seafood/i);
    await expect(chat.destinationItem(0).getByRole('heading')).toHaveText(/^[^,]+, [^,]+$/);
  });

  test('vague input asks one focused question without a shortlist (AC-003-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send('Recommend somewhere');

    const reply = chat.assistantMessage(1);
    await expect(reply).toBeVisible();
    await expect(reply).toContainText('?');
    await expect(reply).not.toContainText(/\?.*\?/s);
    await expect(chat.destinationList).toHaveCount(0);
  });

  test('a follow-up refines the previous shortlist (AC-003-3)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.send('I love warm weather, hiking, and good seafood');
    await expect(chat.destinationList).toBeVisible();

    const originalFirstDestination = await chat.destinationItem(0).innerText();
    await chat.send('Make it cheaper and more beach-focused');

    await expect(chat.assistantMessage(3)).toContainText(/cheap|afford|budget|beach|coast/i);
    await expect(chat.destinationItem(0)).not.toHaveText(originalFirstDestination);
  });

  test('the destination skill is visible in the audit trail (FR-003-5)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send('I love warm weather, hiking, and good seafood');
    await expect(chat.destinationList).toBeVisible();

    await audit.open();

    await expect(audit.panel).toContainText('skill');
    await expect(audit.panel).toContainText('destination-advisor');
  });
});