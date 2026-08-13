import { test, expect } from '@playwright/test';
import { ChatPage } from './pages/chat.page';

/**
 * INC-1 walking-skeleton e2e flow (source: specs/ui/flow-walkthrough.md Flow 1
 * + FRD-001). Red until the Next.js web + Express agent runtime exist.
 */
test.describe('Chat & agent runtime (FRD-001)', () => {
  test('welcome → send → streamed reply (AC-001-1) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await expect(chat.welcome).toBeVisible();
    await chat.expectSendDisabled();

    await chat.send('Hi, I want to plan a holiday');

    // User's message appears, assistant reply streams in and completes.
    await expect(chat.userMessage(0)).toContainText('plan a holiday');
    await expect(chat.assistantMessage(1)).toBeVisible();
    await expect(chat.assistantMessage(1)).not.toBeEmpty();
  });

  test('whitespace-only message is not sent (AC-001-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.type('   ');
    await chat.expectSendDisabled();
    await expect(chat.userMessage(0)).toHaveCount(0);
  });

  test('new chat clears the conversation (AC-001-6)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.send('Somewhere warm please');
    await expect(chat.userMessage(0)).toBeVisible();

    await chat.newChat.click();

    await expect(chat.welcome).toBeVisible();
    await expect(chat.userMessage(0)).toHaveCount(0);
  });

  test('logo returns to the home screen (FR-001-12)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.send('Tell me about Lisbon');
    await chat.brandHome.click();
    await expect(chat.welcome).toBeVisible();
  });

  test('assistant replies render markdown as rich text (bold + lists)', async ({ page }) => {
    const chat = new ChatPage(page);
    await page.goto('/?fault=sample-markdown');
    await chat.send('Give me some options');
    await expect(page.getByTestId('streaming-caret')).toBeHidden();

    const bubble = chat.assistantMessage(1);
    // Raw markdown must not leak through as text.
    await expect(bubble).not.toContainText('**');
    // Structure is rendered: a heading, a two-item bullet list, and bold text.
    await expect(bubble.locator('h3')).toContainText('Two great options');
    await expect(bubble.locator('li')).toHaveCount(2);
    await expect(bubble.locator('li').first().locator('strong')).toContainText('Lisbon');
  });
});
