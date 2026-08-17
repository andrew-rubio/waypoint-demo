import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';
import { assessWeather, estimateClimateFromLatitude } from '../../src/tools/weather-window.js';

/**
 * FRD-004 weather & best-time-to-travel — red baseline for INC-4.
 *
 * These exercise the deterministic LocalAgentDriver (tests/offline). They assert
 * the weather-window skill behaviour and the Open-Meteo MCP audit lifecycle the
 * driver must emit. They FAIL until the driver routes weather/timing turns to the
 * weather-window tool and emits `open-meteo.geocoding` / `open-meteo.climate`
 * MCP events (the driver currently always answers with destination-advisor).
 */
async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: 'weather-test', message, history })) {
    events.push(event);
  }
  return events;
}

function toolResult(events: AgentEvent[], name: string): Record<string, unknown> {
  const result = events.find((event) => event.type === 'tool_result' && event.name === name);
  expect(result, `expected a tool_result named "${name}"`).toBeDefined();
  return (result as Extract<AgentEvent, { type: 'tool_result' }>).result as Record<string, unknown>;
}

function toolCallNames(events: AgentEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'tool_call' }> => event.type === 'tool_call')
    .map((event) => event.name);
}

function reply(events: AgentEvent[]): string {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'token' }> => event.type === 'token')
    .map((event) => event.value)
    .join('');
}

describe('weather-window skill', () => {
  it('reports monthly climate for a resolved place in °C and mm from Open-Meteo (AC-004-1)', async () => {
    const events = await run("What's the weather like in Lisbon in June?");

    // Grounding: the agent geocodes then reads climate via the Open-Meteo MCP.
    const calls = toolCallNames(events);
    expect(calls).toContain('open-meteo.geocoding');
    expect(calls).toContain('open-meteo.climate');

    const result = toolResult(events, 'weather-window');
    expect(result.kind).toBe('month-weather');
    expect(String(result.place)).toMatch(/Lisbon/);
    expect(result.month).toBe('June');
    expect(typeof result.tempMaxC).toBe('number');
    expect(typeof result.tempMinC).toBe('number');
    expect(typeof result.precipMm).toBe('number');
    expect(result.source).toBe('open-meteo');
  });

  it('recommends and warns months for "best time to visit" (AC-004-2)', async () => {
    const result = toolResult(await run("When's the best time to visit Iceland?"), 'weather-window');
    expect(result.kind).toBe('weather-window');
    expect(String(result.place)).toMatch(/Iceland|Reykjav/i);

    const recommended = result.recommendedMonths as Array<{ month: string; reason: string }>;
    const avoid = result.avoidMonths as Array<{ month: string; reason: string }>;
    expect(recommended.length).toBeGreaterThan(0);
    expect(avoid.length).toBeGreaterThan(0);
    for (const entry of [...recommended, ...avoid]) {
      expect(entry.month).toBeTruthy();
      expect(entry.reason).toBeTruthy();
    }
    expect(result.source).toBe('open-meteo');
  });

  it('emits the Open-Meteo MCP call lifecycle so weather is auditable (FR-004-5)', async () => {
    const events = await run("What's the weather like in Lisbon in June?");
    const geocoding = events.find((e) => e.type === 'tool_result' && e.name === 'open-meteo.geocoding');
    const climate = events.find((e) => e.type === 'tool_result' && e.name === 'open-meteo.climate');
    expect(geocoding).toBeDefined();
    expect(climate).toBeDefined();
    expect((geocoding as Extract<AgentEvent, { type: 'tool_result' }>).ok).toBe(true);
    expect((climate as Extract<AgentEvent, { type: 'tool_result' }>).ok).toBe(true);
  });

  it('says it cannot locate an unknown place and asks for a real one (AC-004-4)', async () => {
    const events = await run("What's the weather like in Wakanda?");
    const result = toolResult(events, 'weather-window');
    expect(result.kind).toBe('unknown-place');
    expect(reply(events)).toMatch(/could ?n'?t locate|couldn'?t find|unable to locate/i);
    expect(reply(events)).toMatch(/real destination|another place|which place/i);
  });

  it('offers candidate matches for an ambiguous place name', async () => {
    const events = await run("What's the weather like in Springfield?");
    const result = toolResult(events, 'weather-window');
    expect(result.kind).toBe('ambiguous-place');
    const candidates = result.candidates as Array<{ name: string; country: string }>;
    expect(candidates.length).toBeGreaterThan(1);
  });

  it('reports no data for an open-ocean point instead of fabricating figures', async () => {
    const events = await run("What's the typical weather at Point Nemo in the South Pacific?");
    const result = toolResult(events, 'weather-window');
    expect(result.kind).toBe('no-data');
    expect(reply(events)).toMatch(/not available|no (climate )?data|couldn'?t find climate/i);
  });

  it('still answers destination requests via destination-advisor (regression)', async () => {
    const events = await run('Suggest destinations for warm weather, hiking, and good seafood');
    const result = toolResult(events, 'destination-advisor');
    expect(result.kind).toBe('shortlist');
  });

  it('resolves a contextual place ("there") from the conversation, not a different location (BUG-002)', async () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'Where is best to travel with mountain landscapes?', ts: '2026-08-14T00:00:00Z' },
      { role: 'assistant', content: 'For mountains, consider Innsbruck, Austria; Zermatt, Switzerland; and Tromsø.', ts: '2026-08-14T00:00:01Z' },
      { role: 'user', content: 'Tell me more about Innsbruck', ts: '2026-08-14T00:00:02Z' },
      { role: 'assistant', content: 'Innsbruck, Austria sits in the Alps with skiing and mountain trails.', ts: '2026-08-14T00:00:03Z' },
    ];
    const result = toolResult(
      await run('When are the best months to travel there without it being too hot?', history),
      'weather-window',
    );
    expect(result.kind).toBe('weather-window');
    expect(String(result.place)).toMatch(/Innsbruck/);
  });

  it('shows a loading status while looking up weather data, then clears it', async () => {
    const events = await run('What is the weather like in Lisbon in October?');
    const statuses = events.filter((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status').map((e) => e.message);
    expect(statuses.some((m) => /looking up weather data/i.test(m))).toBe(true);
    expect(statuses).toContain('');
  });
});

describe('weather climate failsafe', () => {
  it('estimates a plausible, seasonal climate from latitude for any point (Tokyo)', () => {
    const rows = estimateClimateFromLatitude(35.69, 'Tokyo, Japan');
    expect(rows).toHaveLength(12);
    const nov = rows.find((r) => r.month === 'November')!;
    expect(nov.tempMaxC).toBeGreaterThan(0);
    expect(nov.tempMaxC).toBeLessThan(30);
    // Northern-hemisphere seasonality: July warmer than January.
    expect(rows.find((r) => r.month === 'July')!.tempMaxC).toBeGreaterThan(rows.find((r) => r.month === 'January')!.tempMaxC);
  });

  it('marks month-weather as estimated (not a false ERA5 claim) on the failsafe path', () => {
    const climate = estimateClimateFromLatitude(35.69, 'Tokyo, Japan');
    const result = assessWeather({ place: 'Tokyo', resolvedName: 'Tokyo, Japan', intent: 'month-weather', month: 'November', climate, estimated: true });
    expect(result.kind).toBe('month-weather');
    if (result.kind === 'month-weather') {
      expect(result.estimated).toBe(true);
      expect(result.baseline ?? '').not.toContain('1991');
    }
  });
});
