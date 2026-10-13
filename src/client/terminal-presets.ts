export type TerminalStartupPreset = 'resource-monitor';

export const terminalStartupStorageKey = (machineId: string, tabId: string) => `webr-terminal-startup:${encodeURIComponent(machineId)}:${encodeURIComponent(tabId)}`;

export const terminalStartupCommands: Record<TerminalStartupPreset, string> = {
  'resource-monitor': 'if command -v btop >/dev/null 2>&1; then btop; elif command -v htop >/dev/null 2>&1; then htop; else top; fi',
};
