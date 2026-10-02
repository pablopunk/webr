const DEFAULT_PORT = 4321;
const portArgument = (args: string[]) => { const index = args.indexOf('--port'); return index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith('--port='))?.slice('--port='.length); };

export function serverPort(args = process.argv.slice(2), env = process.env) {
  const port = Number(portArgument(args) ?? env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port must be a number from 1 to 65535.');
  return port;
}
