import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exampleThreads, harnessName, projects, type Thread } from './models';
import { findMachine } from './machines';

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
  const examples = exampleThreads();
  const saved = (await savedThreads()).map((thread, index) => ({
    ...thread, avatarIndex: thread.avatarIndex ?? examples.length + index,
    prompt: thread.prompt ?? thread.title, model: thread.model ?? 'Default',
    machineId: thread.machineId ?? 'local',
  }));
  return [...examples, ...saved]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findThread(id: string): Promise<Thread | undefined> {
  return (await listThreads()).find((thread) => thread.id === id);
}

export function createThread(input: {
  projectId: string;
  machineId: string;
  prompt: string;
  agent: string;
  model: string;
  worktree: boolean;
}): Promise<Thread> {
  const operation = pendingWrite.then(async () => {
    const machine = findMachine(input.machineId);
    if (!machine?.connected) throw new Error('Machine is not connected');
    if (!projects.some((project) => project.id === input.projectId)) throw new Error('Unknown project');
    if (!Object.hasOwn(machine.projectPaths, input.projectId)) throw new Error('Project is not available on this machine');
    if (!machine.harnesses.some((harness) => harness.id === input.agent.trim())) throw new Error('Harness is not available on this machine');
    const id = randomUUID().slice(0, 8);
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 8000 || !input.agent.trim() || !input.model.trim()) throw new Error('Invalid thread details');
    const name = prompt.split('\n').find((line) => line.trim())?.trim().replace(/\s+/g, ' ').slice(0, 90) ?? '';
    if (!name) throw new Error('Enter a prompt');
    const branch = input.worktree
      ? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}-${id}`
      : 'main';
    const threads = await savedThreads();
    const thread: Thread = {
      id, avatarIndex: exampleThreads().length + threads.length,
      projectId: input.projectId, machineId: machine.id, title: name, prompt, agent: input.agent.trim(), model: input.model.trim(),
      status: 'idle', updatedAt: new Date().toISOString(), branch,
      worktree: input.worktree, session: machine.session, tabId: `mock:t${id}`,
      panes: [{ id: `mock:p${id}`, title: harnessName(input.agent.trim()), kind: 'agent', lines: [
        `Machine: ${machine.name} · ${machine.projectPaths[input.projectId]}`,
        `${harnessName(input.agent.trim())} · ${input.model.trim()}`, 'Prompt:',
        ...prompt.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').split('\n'), '',
        'This is a design prototype. The Herdr connection is not active yet.',
        'Type in this terminal to try the layout.', '', '$',
      ] }],
    };
    await mkdir(join(process.cwd(), '.data'), { recursive: true });
    const tempFile = `${dataFile}.${id}.tmp`;
    await writeFile(tempFile, JSON.stringify([...threads, thread], null, 2));
    await rename(tempFile, dataFile);
    return thread;
  });
  pendingWrite = operation.catch(() => {});
  return operation;
}
