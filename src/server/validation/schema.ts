import { validateInstalledSchema } from '../protocol/validate';
type Node = { properties?: Record<string, Node>; const?: unknown; oneOf?: Node[]; $defs?: Record<string, Node> };
export function validateValidatorSchema(input: unknown) {
  const schema = input as { protocol?: number; schemas?: Record<string, Node> };
  const errors = validateInstalledSchema(schema);
  const request = schema.schemas?.request;
  const methods = new Set(request?.oneOf?.map((node) => node.properties?.method?.const));
  for (const method of ['workspace.create', 'workspace.close', 'worktree.remove', 'pane.get', 'pane.process_info', 'pane.read', 'pane.send_input']) if (!methods.has(method)) errors.push('Missing validator method: ' + method);
  for (const [record, fields] of Object.entries({ WorkspaceCreateParams: ['cwd', 'label', 'focus'], WorkspaceCloseParams: ['workspace_id', 'close_group'], PaneSendInputParams: ['pane_id', 'text', 'keys'], PaneReadParams: ['pane_id', 'source', 'format', 'lines', 'strip_ansi'], PaneProcessInfoParams: ['pane_id'], WorktreeRemoveParams: ['workspace_id', 'force'] })) for (const field of fields) if (!request?.$defs?.[record]?.properties?.[field]) errors.push('Missing validator field: ' + record + '.' + field);
  return errors;
}
