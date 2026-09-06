import { describe, it, expect } from 'vitest';
import { selectControls } from '../src/select.js';
import { loadCatalogue } from '../src/catalog.js';
import { ControlCatalogue } from '../src/types.js';
import { sampleCatalogue, sampleProposition } from './fixtures.js';

describe('deterministic control selection', () => {
  it('selects controls whose predicates all hold', () => {
    const selection = selectControls(sampleProposition(), sampleCatalogue());
    const ids = selection.selected.map((s) => s.controlId);
    // usesLLM, humanInLoop, handlesPersonalData, externalIntegrations contains mcp → all four apply.
    expect(ids).toEqual(['DATA-MIN-001', 'OPS-TRACE-001', 'RAI-HITL-001', 'SEC-MCP-001']);
  });

  it('is order-stable (controls sorted by id)', () => {
    const a = selectControls(sampleProposition(), sampleCatalogue()).selected.map((s) => s.controlId);
    const b = selectControls(sampleProposition(), sampleCatalogue()).selected.map((s) => s.controlId);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(a);
  });

  it('omits controls whose predicate fails', () => {
    const prop = sampleProposition();
    prop.characteristics.handlesPersonalData = false;
    prop.characteristics.dataClassification = 'public';
    const ids = selectControls(prop, sampleCatalogue()).selected.map((s) => s.controlId);
    expect(ids).not.toContain('DATA-MIN-001');
  });

  it('records a rationale and the matching predicates for each selected control', () => {
    const selection = selectControls(sampleProposition(), sampleCatalogue());
    const mcp = selection.selected.find((s) => s.controlId === 'SEC-MCP-001')!;
    expect(mcp.matchedBy.length).toBeGreaterThan(0);
    expect(mcp.rationale).toContain('externalIntegrations contains "mcp"');
  });

  it('flags a missing-classification conflict deterministically', () => {
    const prop = sampleProposition();
    prop.characteristics.dataClassification = 'restricted';
    prop.characteristics.handlesPersonalData = false;
    const findings = selectControls(prop, sampleCatalogue()).findings.map((f) => f.code);
    expect(findings).toContain('missing-classification');
  });

  it('refuses a catalogue not labelled synthetic', () => {
    const bad = { ...sampleCatalogue(), synthetic: false };
    expect(() => ControlCatalogue.parse(bad)).toThrow();
  });
});
