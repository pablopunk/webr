export type ServiceSpec = {
  nodePath: string;
  entry: string;
  args: string[];
  env: Record<string, string>;
  userHome: string;
  logPath: string;
};

export type CommandResult = { ok: boolean; output: string };
export type RunCommand = (command: string, args: string[], env?: NodeJS.ProcessEnv) => CommandResult;
export type ServiceStatus = { installed: boolean; running: boolean };

export type ServicePlatform = {
  name: string;
  install: (spec: ServiceSpec, run: RunCommand) => string[];
  restart: (spec: ServiceSpec, run: RunCommand) => string[];
  uninstall: (spec: ServiceSpec, run: RunCommand) => string[];
  status: (spec: ServiceSpec, run: RunCommand) => ServiceStatus;
};
