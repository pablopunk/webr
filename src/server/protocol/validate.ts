type SchemaNode = { const?: unknown; required?: string[]; properties?: Record<string, SchemaNode>; oneOf?: SchemaNode[]; $defs?: Record<string, SchemaNode> };
type Schema = { protocol?: number; schemas?: Record<string, SchemaNode> };
export function validateInstalledSchema(schema: Schema) {
  const errors: string[] = [];
  if (schema.protocol !== 22) errors.push('Unsupported protocol: expected 22');
  const request = schema.schemas?.request;
  const methods = new Set(request?.oneOf?.map((variant) => variant.properties?.method?.const));
  for (const method of ['ping', 'session.snapshot', 'events.subscribe', 'workspace.create', 'tab.create', 'worktree.create', 'agent.start', 'agent.get', 'agent.prompt', 'pane.report_metadata']) if (!methods.has(method)) errors.push('Missing method: ' + method);
  const requiredFields = { SessionSnapshot: ['version', 'protocol', 'workspaces', 'tabs', 'panes', 'layouts', 'agents'], PaneInfo: ['pane_id', 'terminal_id', 'workspace_id', 'tab_id'], PaneLayoutSnapshot: ['area', 'panes', 'tab_id', 'workspace_id'] };
  for (const [record, fields] of Object.entries(requiredFields)) for (const field of fields) if (!schema.schemas?.success_response?.$defs?.[record]?.required?.includes(field)) errors.push('Missing required response field: ' + record + '.' + field);
  if (!request?.$defs?.EventsSubscribeParams?.required?.includes('subscriptions')) errors.push('Missing EventsSubscribeParams.subscriptions');
  for (const [record, fields] of Object.entries({ AgentStartParams: ['name', 'kind', 'pane_id', 'args', 'timeout_ms'], AgentPromptParams: ['target', 'text'], WorkspaceCreateParams: ['cwd', 'label', 'focus'], TabCreateParams: ['workspace_id', 'cwd', 'label', 'focus'], WorktreeCreateParams: ['workspace_id', 'branch', 'label', 'focus'], PaneReportMetadataParams: ['pane_id', 'source', 'tokens'] })) for (const field of fields) if (!request?.$defs?.[record]?.properties?.[field]) errors.push('Missing request field: ' + record + '.' + field);
  const statusSubscription = request?.$defs?.Subscription?.oneOf?.find((variant) => variant.properties?.type?.const === 'pane.agent_status_changed');
  if (!statusSubscription?.required?.includes('pane_id')) errors.push('Missing pane-scoped status subscription');
  for (const field of ['name', 'pane_id', 'terminal_id', 'agent', 'agent_status']) if (!schema.schemas?.success_response?.$defs?.AgentInfo?.properties?.[field]) errors.push('Missing agent identity field: ' + field);
  for (const [record, fields] of Object.entries({ PaneInfo: ['agent_session', 'restore_error', 'foreground_cwd', 'tokens'], AgentInfo: ['agent_session', 'cwd', 'foreground_cwd'], AgentSessionInfo: ['source', 'agent', 'kind', 'value'] })) for (const field of fields) if (!schema.schemas?.success_response?.$defs?.[record]?.properties?.[field]) errors.push('Missing recovery response field: ' + record + '.' + field);
  return errors;
}
