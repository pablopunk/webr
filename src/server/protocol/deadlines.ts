export const AGENT_READY_TIMEOUT_MS = 30_000;
export const SHELL_READY_TIMEOUT_MS = 15_000;
export const TRANSPORT_MARGIN_MS = 5000;
export const WORKTREE_TIMEOUT_MS = 120_000;
export const MAX_RPC_TIMEOUT_MS = 305_000;
export type RpcOptions = { timeoutMs: number; requestId?: string };

export function requestDeadline(method: string, params: Record<string, unknown>, readDeadline = 5000, options?: RpcOptions) {
  let timeout = readDeadline;
  if (method === 'agent.start') {
    const ready = params.timeout_ms ?? AGENT_READY_TIMEOUT_MS;
    if (typeof ready !== 'number' || !Number.isInteger(ready) || ready <= 3000 || ready > 300_000) throw new Error('invalid_ready_timeout');
    timeout = ready + TRANSPORT_MARGIN_MS;
  }
  if (method === 'worktree.create') timeout = WORKTREE_TIMEOUT_MS;
  if (method === 'tab.create' || method === 'workspace.create') timeout = 30_000;
  timeout = options?.timeoutMs ?? timeout;
  const maximum = ['agent.start', 'worktree.create', 'tab.create', 'workspace.create'].includes(method) ? MAX_RPC_TIMEOUT_MS : 5000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > maximum) throw new Error('invalid_rpc_timeout');
  return timeout;
}
