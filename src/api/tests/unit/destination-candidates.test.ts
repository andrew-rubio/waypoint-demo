import { describe, expect, it } from 'vitest';
import { adviseDestinations } from '../../src/tools/destination-advisor.js';
import type { DestinationShortlistResult } from '../../../shared/types/destination-advice.js';

function shortlist(result: ReturnType<typeof adviseDestinations>): DestinationShortlistResult {
  expect(result.kind).toBe('shortlist');
  return result as DestinationShortlistResult;
}

function names(result: ReturnType<typeof adviseDestinations>): string[] {
  return shortlist(result).suggestions.map((s) => s.name);
}

describe('destination-advisor candidate generation and validation', () => {
  it('produces varied, preference-appropriate shortlists for different requests', () => {
    const warm = adviseDestinations({ interests: ['warm weather, hiking, and good seafood'], constraints: [] });
    const city = adviseDestinations({ interests: ['budget city break with great food and nightlife'], constraints: [] });
    const cold = adviseDestinations({ interests: ['cold northern lights and skiing'], constraints: [] });

    for (const result of [warm, city, cold]) {
      const list = shortlist(result);
      expect(list.suggestions.length).toBeGreaterThanOrEqual(3);
      expect(list.suggestions.length).toBeLessThanOrEqual(5);
      for (const suggestion of list.suggestions) {
        expect(suggestion.name).toMatch(/^[^,]+, [^,]+$/);
        expect(suggestion.rationale.trim().length).toBeGreaterThan(0);
        expect(suggestion.tags.length).toBeGreaterThan(0);
      }
    }

    // Different preference profiles must not collapse to one identical list.
    expect(names(warm)).not.toEqual(names(city));
    expect(names(warm)).not.toEqual(names(cold));
    expect(names(city)).not.toEqual(names(cold));
  });

  it('validates, de-duplicates, and ranks caller-proposed candidates', () => {
    const result = adviseDestinations({
      interests: ['warm beaches', 'seafood'],
      constraints: [],
      candidates: [
        { name: 'Barcelona, Spain', rationale: 'Warm city beaches and celebrated seafood.', matchedPreferences: ['warm', 'beaches', 'seafood'] },
        { name: 'Barcelona, Spain', rationale: 'Duplicate entry that must be dropped.', matchedPreferences: ['warm'] },
        { name: 'Nice', rationale: 'Malformed: no country, must be rejected.', matchedPreferences: ['warm'] },
        { name: 'Valencia, Spain', rationale: 'Warm urban beach with local food.', matchedPreferences: ['warm', 'beaches'] },
        { name: 'Split, Croatia', rationale: 'Adriatic seafood coast.', matchedPreferences: ['seafood'] },
      ],
    });

    const list = names(result);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(5);
    // Malformed names are rejected.
    expect(list).not.toContain('Nice');
    // Duplicates collapse to a single entry.
    expect(list.filter((n) => n === 'Barcelona, Spain')).toHaveLength(1);
    // Candidates matching more preferences rank higher.
    expect(list.indexOf('Barcelona, Spain')).toBeLessThan(list.indexOf('Split, Croatia'));
  });

  it('falls back to a valid shortlist when the caller proposes no usable candidates', () => {
    const result = adviseDestinations({
      interests: ['warm weather and hiking'],
      constraints: [],
      candidates: [{ name: 'Paris', rationale: 'Malformed, rejected.' }],
    });

    const list = shortlist(result);
    expect(list.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(list.suggestions.length).toBeLessThanOrEqual(5);
    for (const suggestion of list.suggestions) {
      expect(suggestion.name).toMatch(/^[^,]+, [^,]+$/);
    }
  });
});
