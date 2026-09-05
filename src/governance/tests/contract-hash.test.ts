import { describe, it, expect } from 'vitest';
import { buildControlContract } from '../src/contract.js';
import { selectControls } from '../src/select.js';
import { sampleCatalogue, sampleProposition } from './fixtures.js';

function contractFor(mutate?: (p: ReturnType<typeof sampleProposition>, c: ReturnType<typeof sampleCatalogue>) => void) {
  const prop = sampleProposition();
  const cat = sampleCatalogue();
  mutate?.(prop, cat);
  const selection = selectControls(prop, cat);
  return buildControlContract(prop, cat, selection, { contractVersion: '1.0.0', generatedAt: 'FIXED' });
}

describe('deterministic contract hashing', () => {
  it('identical inputs produce an identical contract hash', () => {
    expect(contractFor().contractHash).toEqual(contractFor().contractHash);
  });

  it('generatedAt is outside the hash — a different timestamp does not change the hash', () => {
    const prop = sampleProposition();
    const cat = sampleCatalogue();
    const sel = selectControls(prop, cat);
    const a = buildControlContract(prop, cat, sel, { contractVersion: '1.0.0', generatedAt: '2026-01-01T00:00:00Z' });
    const b = buildControlContract(prop, cat, sel, { contractVersion: '1.0.0', generatedAt: '2026-09-06T12:00:00Z' });
    expect(a.contractHash).toEqual(b.contractHash);
  });

  it('a changed obligation (material) changes the hash', () => {
    const base = contractFor().contractHash;
    const changed = contractFor((_p, c) => {
      c.controls[0].obligation = 'A materially different obligation.';
    }).contractHash;
    expect(changed).not.toEqual(base);
  });

  it('a changed evaluation threshold changes the hash', () => {
    const base = contractFor().contractHash;
    const changed = contractFor((_p, c) => {
      c.controls.find((x) => x.id === 'SEC-MCP-001')!.evidenceRequirements[0].threshold = 0.9;
    }).contractHash;
    expect(changed).not.toEqual(base);
  });

  it('a changed severity (blocking→advisory) changes the hash', () => {
    const base = contractFor().contractHash;
    const changed = contractFor((_p, c) => {
      c.controls.find((x) => x.id === 'SEC-MCP-001')!.severity = 'advisory';
    }).contractHash;
    expect(changed).not.toEqual(base);
  });
});
