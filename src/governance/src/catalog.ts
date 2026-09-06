import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ControlCatalogue, PropositionDeclaration } from './types.js';

/**
 * Load + validate a synthetic control catalogue. The engine refuses any catalogue not
 * explicitly labelled `synthetic: true` so demonstration policy can never be mistaken
 * for authoritative organisational policy.
 */
export function loadCatalogue(path: string): ControlCatalogue {
  const parsed = parseYaml(readFileSync(path, 'utf8'));
  return ControlCatalogue.parse(parsed);
}

export function loadProposition(path: string): PropositionDeclaration {
  const parsed = parseYaml(readFileSync(path, 'utf8'));
  return PropositionDeclaration.parse(parsed);
}
