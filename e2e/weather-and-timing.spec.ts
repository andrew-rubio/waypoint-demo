import { test, expect } from '@playwright/test';
import { AuditPanel } from './pages/audit.page';
import { ChatPage } from './pages/chat.page';

test.describe('Weather & best-time-to-travel (FRD-004) @flow:weather @frd:FRD-004', () => {
  test('monthly weather is reported in °C and mm, sourced from Open-Meteo (AC-004-1) @smoke', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send("What's the weather like in Lisbon in June?");

    await expect(chat.weatherCard).toBeVisible();
    await expect(chat.weatherCard).toContainText(/Lisbon, Portugal/);
    await expect(chat.weatherCard).toContainText('June');
    await expect(chat.weatherCard).toContainText('°C');
    await expect(chat.weatherCard).toContainText('mm');
    await expect(chat.weatherSource).toContainText(/Open-Meteo/i);
  });

  test('best-time-to-visit lists recommended and avoid months (AC-004-2)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send("When's the best time to visit Iceland?");

    await expect(chat.weatherCard).toBeVisible();
    await expect(chat.weatherRecommended.getByRole('listitem').first()).toBeVisible();
    await expect(chat.weatherAvoid.getByRole('listitem').first()).toBeVisible();
    await expect(chat.weatherSource).toContainText(/Open-Meteo/i);
  });

  test('an unknown place cannot be located and no card is shown (AC-004-4)', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send("What's the weather like in Wakanda?");

    const reply = chat.assistantMessage(1);
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(/could ?n'?t locate|couldn'?t find|unable to locate/i);
    await expect(chat.weatherCard).toHaveCount(0);
  });

  test('weather activity is grounded in Open-Meteo MCP calls in the audit trail (AC-004-3, FR-004-5)', async ({ page }) => {
    const chat = new ChatPage(page);
    const audit = new AuditPanel(page);
    await chat.goto();
    await chat.send("What's the weather like in Lisbon in June?");
    await expect(chat.weatherCard).toBeVisible();

    await audit.open();

    const mcp = audit.entriesOfType('mcp');
    await expect(mcp.filter({ hasText: 'open-meteo.geocoding' })).toHaveAttribute('data-status', 'ok');
    await expect(mcp.filter({ hasText: 'open-meteo.climate' })).toHaveAttribute('data-status', 'ok');
  });

  test('a weather service failure degrades gracefully without crashing (Flow 7)', async ({ page }) => {
    const chat = new ChatPage(page);
    await page.goto('/?fault=weather-mcp-error');

    await chat.send("What's the weather like in Lisbon in June?");

    await expect(chat.errorNotice).toContainText('Weather data is unavailable right now');
    await expect(chat.input).toBeEnabled();
    await expect(chat.weatherCard).toHaveCount(0);
  });
});
