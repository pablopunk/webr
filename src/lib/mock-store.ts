import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exampleThreads, projects, type AgentKind, type Thread } from './models';

const dataFile = join(process.cwd(), '.data', 'threads.json');
let pendingWrite: Promise<unknown> = Promise.resolve();

async function savedThreads(): Promise<Thread[]> {
  try {
    return JSON.parse(await readFile(dataFile, 'utf8')) as Thread[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function listThreads(): Promise<Thread[]> {
  await pendingWrite;
  return [...exampleThreads(), ...await savedThreads()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findThread(id: string): Promise<Thread | undefined> {
  return (await listThreads()).find((thread) => thread.id === id);
}

export function createThread(input: {
  projectId: string;
  title: string;
  agent: AgentKind;
  worktree: boolean;
}): Promise<Thread> {
  const operation = pendingWrite.then(async () => {
    if (!projects.some((project) => project.id === input.projectId)) throw new Error('Unknown project');
    const id = randomUUID().slice(0, 8);
    const name = input.title.trim().slice(0, 90);
    if (!name) throw new Error('Enter a thread name');
    const branch = input.worktree
      ? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}-${id}`
      : 'main';
    const thread: Thread = {
      id, projectId: input.projectId, title: name, agent: input.agent,
      status: 'idle', updatedAt: new Date().toISOString(), branch,
      worktree: input.worktree, session: 'default', tabId: `mock:t${id}`,
      panes: [{ id: `mock:p${id}`, title: input.agent, kind: 'agent', lines: [
        `$ ${input.agent}`, `New thread: ${name}`, '',
        'This is a design prototype. The Herdr connection is not active yet.',
        'Type in this terminal to try the layout.', '', '$',
      ] }],
    };
    const threads = await savedThreads();
    await mkdir(join(process.cwd(), '.data'), { recursive: true });
    const tempFile = `${dataFile}.${id}.tmp`;
    await writeFile(tempFile, JSON.stringify([...threads, thread], null, 2));
    await rename(tempFile, dataFile);
    return thread;
  });
  pendingWrite = operation.catch(() => {});
  return operation;
}
