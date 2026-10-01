export type MachineHarness = { id: string; name: string; models: string[]; launchEnabled?: boolean; reason?: string };
export type Machine = {
  id: string;
  name: string;
  connected: boolean;
  session: string;
  projectPaths: Record<string, string>;
  harnesses: MachineHarness[];
  error?: string;
  writable?: boolean;
  configVersion?: number;
};

export const machines: Machine[] = [
  {
    id: 'local', name: 'Local', connected: true, session: 'default',
    projectPaths: { herdr: '~/src/herdr', maze: '~/src/maze/monorepo', spotifin: '~/src/spotifin' },
    harnesses: [
      { id: 'claude', name: 'Claude Code', models: ['Default', 'sonnet', 'opus'] },
      { id: 'codex', name: 'Codex', models: ['Default'] },
      { id: 'opencode', name: 'OpenCode', models: ['Default'] },
      { id: 'pi', name: 'Pi', models: ['Default'] },
    ],
  },
  {
    id: 'demo-build', name: 'Build machine (demo)', connected: true, session: 'agents',
    projectPaths: { herdr: '/srv/herdr', spotifin: '/srv/spotifin' },
    harnesses: [
      { id: 'opencode', name: 'OpenCode', models: ['Default', 'demo/remote-model'] },
      { id: 'pi', name: 'Pi', models: ['Default', 'demo/remote-model'] },
    ],
  },
  {
    id: 'demo-offline', name: 'Offline machine (demo)', connected: false, session: 'default',
    projectPaths: {}, harnesses: [],
  },
];

export function findMachine(id: string): Machine | undefined {
  return machines.find((machine) => machine.id === id);
}
