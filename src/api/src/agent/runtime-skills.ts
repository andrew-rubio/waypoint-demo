import { fileURLToPath } from 'node:url';
import type { SessionConfig } from '@github/copilot-sdk';

const skillRoot = fileURLToPath(new URL('./skills', import.meta.url));

type SkillSessionConfig = Pick<
  SessionConfig,
  'agent' | 'customAgents' | 'enableSkills' | 'skillDirectories'
>;

/** Native Copilot SDK skill discovery and preload configuration for Waypoint. */
export const waypointSkillSessionConfig = {
  enableSkills: true,
  skillDirectories: [skillRoot],
  customAgents: [
    {
      name: 'waypoint',
      displayName: 'Waypoint',
      description: 'A concise holiday-planning agent with trusted travel tools.',
      prompt:
        'Help travellers plan holidays. Apply the preloaded skills and ground structured recommendations in their trusted tools.',
      skills: ['destination-advice'],
      tools: ['destination-advisor'],
    },
  ],
  agent: 'waypoint',
} satisfies SkillSessionConfig;
