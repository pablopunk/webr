import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPOSITORY = 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main';
const MODEL_FILES = { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' } as const;

export type ModelFiles = Record<keyof typeof MODEL_FILES, string>;

export const modelDirectory = (home: string) => join(home, 'models', 'parakeet-tdt-0.6b-v3-int8');
export const modelFiles = (directory: string) => Object.fromEntries(Object.entries(MODEL_FILES).map(([key, name]) => [key, join(directory, name)])) as ModelFiles;

const exists = (path: string) => stat(path).then((entry) => entry.size > 0, () => false);

export async function isModelDownloaded(directory: string) {
  return (await Promise.all(Object.values(modelFiles(directory)).map(exists))).every(Boolean);
}

async function downloadFile(url: string, destination: string) {
  if (await exists(destination)) return;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  const partial = `${destination}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
    await rename(partial, destination);
  } catch (error) { await rm(partial, { force: true }); throw error; }
}

export async function downloadModel(directory: string, repository = REPOSITORY) {
  await mkdir(directory, { recursive: true });
  for (const name of Object.values(MODEL_FILES)) await downloadFile(`${repository}/${name}`, join(directory, name));
}
