import { isAbsolute, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { waypointSkillSessionConfig } from '../../src/agent/runtime-skills.js';

describe('Waypoint runtime skills', () => {
  it('preloads the holiday-guide Markdown skill with its trusted tool', async () => {
    expect(waypointSkillSessionConfig.enableSkills).toBe(true);
    expect(waypointSkillSessionConfig.agent).toBe('waypoint');
    expect(waypointSkillSessionConfig.skillDirectories).toHaveLength(1);

    const skillRoot = waypointSkillSessionConfig.skillDirectories[0];
    expect(isAbsolute(skillRoot)).toBe(true);

    const agent = waypointSkillSessionConfig.customAgents[0];
    expect(agent.name).toBe('waypoint');
    expect(agent.skills).toContain('holiday-guide');
    expect(agent.tools).toContain('destination-advisor');

    const markdown = await readFile(join(skillRoot, 'holiday-guide', 'SKILL.md'), 'utf8');
    expect(markdown).toMatch(/^---\r?\nname: holiday-guide\r?\n/m);
    expect(markdown).toMatch(/description:/);
    expect(markdown).toMatch(/destination-advisor/);
    expect(markdown).toMatch(/exactly one focused question/i);
  });
});