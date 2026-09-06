import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** Repo root = four levels up from src/governance/src/io.ts. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

/** Canonical artefact locations (transparent, version-controlled). */
export const PATHS = {
  catalogue: repoPath('specs/governance/controls.yaml'),
  proposition: repoPath('specs/governance/proposition.yaml'),
  propositionDraft: repoPath('specs/governance/proposition.draft.yaml'),
  selection: repoPath('specs/governance/control-selection.json'),
  contract: repoPath('specs/governance/control-contract.yaml'),
  approval: repoPath('specs/governance/approval-record.json'),
  evidenceManifest: repoPath('specs/governance/.out/evidence-manifest.json'),
  releaseDecision: repoPath('specs/governance/.out/release-decision.json'),
  dossierJson: repoPath('specs/governance/.out/dossier.json'),
  dossierMd: repoPath('specs/governance/.out/dossier.md'),
  auditLog: repoPath('specs/governance/governance-audit.jsonl'),
  learningDir: repoPath('specs/learning'),
} as const;

export function readYamlFile<T = unknown>(path: string): T {
  return parseYaml(readFileSync(path, 'utf8')) as T;
}

export function readJsonFile<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readJsonIfExists<T = unknown>(path: string): T | undefined {
  return existsSync(path) ? readJsonFile<T>(path) : undefined;
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function writeYamlFile(path: string, value: unknown): void {
  ensureDir(path);
  writeFileSync(path, stringifyYaml(value), 'utf8');
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function writeTextFile(path: string, text: string): void {
  ensureDir(path);
  writeFileSync(path, text, 'utf8');
}

/** Best-effort current commit; undefined outside a git checkout. */
export function currentCommit(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/** Parse "--key value" and "--flag" from argv (after the subcommand). */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
