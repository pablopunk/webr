type Schema = { protocol?: number; schemas?: Record<string, { $defs?: Record<string, { required?: string[]; properties?: Record<string, unknown>; oneOf?: { properties?: { method?: { const?: string } } }[] }>; oneOf?: { properties?: { method?: { const?: string } } }[] }> };
export function validateInstalledSchema(schema: Schema) {
  const errors: string[] = [];
  if (schema.protocol !== 22) errors.push('Unsupported protocol: expected 22');
  const request = schema.schemas?.request;
  const methods = new Set(request?.oneOf?.map((variant) => variant.properties?.method?.const));
  for (const method of ['ping', 'session.snapshot', 'events.subscribe', 'tab.create', 'worktree.create', 'agent.start', 'agent.get', 'agent.prompt']) if (!methods.has(method)) errors.push('Missing method: ' + method);
  const requiredFields = { SessionSnapshot: ['version', 'protocol', 'workspaces', 'tabs', 'panes', 'layouts', 'agents'], PaneInfo: ['pane_id', 'terminal_id', 'workspace_id', 'tab_id'], PaneLayoutSnapshot: ['area', 'panes', 'tab_id', 'workspace_id'] };
  for (const [record, fields] of Object.entries(requiredFields)) for (const field of fields) if (!schema.schemas?.success_response?.$defs?.[record]?.required?.includes(field)) errors.push('Missing required response field: ' + record + '.' + field);
  if (!request?.$defs?.EventsSubscribeParams?.required?.includes('subscriptions')) errors.push('Missing EventsSubscribeParams.subscriptions');
  return errors;
}
