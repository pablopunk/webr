export const herdrAgentKinds = ['pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline', 'omp', 'mastracode', 'opencode', 'copilot', 'kimi', 'kiro', 'droid', 'amp', 'grok', 'hermes', 'kilo', 'qodercli', 'qwen', 'letta', 'maki', 'muse', 'fx'];
const kindsWithModelFlag = ['claude', 'codex', 'opencode', 'pi', 'agy', 'hermes', 'fx'];
export const isHerdrAgentKind = (kind: string) => herdrAgentKinds.includes(kind);
export const acceptsModelFlag = (kind: string) => kindsWithModelFlag.includes(kind);
