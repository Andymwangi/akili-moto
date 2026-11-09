import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findLeakedContent, findLeakedWords } from '../src/shared/lib/bundle-leaks';

export { findLeakedContent, findLeakedWords } from '../src/shared/lib/bundle-leaks';

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

async function readFinalList(path: string): Promise<string[]> {
  try {
    const contents = await readFile(path, 'utf8');
    return contents
      .split(/\r?\n/)
      .map((word) => word.trim())
      .filter((word) => /^[a-z]{5}$/.test(word));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readQuestionContent(path: string): Promise<string[]> {
  const contents: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(contents)) throw new Error('Quiz question bank must be a JSON array.');
  const text: string[] = [];
  for (const entry of contents) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid quiz question entry.');
    const record = entry as {
      prompt?: unknown;
      explanation?: unknown;
      sourceUrl?: unknown;
      options?: unknown;
    };
    if (
      typeof record.prompt !== 'string' ||
      typeof record.explanation !== 'string' ||
      typeof record.sourceUrl !== 'string' ||
      !Array.isArray(record.options) ||
      record.options.some((option) => typeof option !== 'string')
    ) {
      throw new Error('Invalid quiz question content.');
    }
    const questionText = [record.prompt, record.explanation, ...record.options];
    text.push(...questionText.filter((value): value is string => value.length >= 24));
  }
  return text;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const assetRoot = resolve(root, 'dist/client');
  let files: string[];
  try {
    files = await listFiles(assetRoot);
  } catch {
    throw new Error('Client build output is missing; run the production build first.');
  }
  // Every question bank in data/ is server-only, including versions added later.
  const questionBanks = (await readdir(resolve(root, 'data')))
    .filter((name) => /quiz-questions.*\.json$/.test(name))
    .sort();
  if (questionBanks.length === 0) throw new Error('No quiz question banks found in data/.');
  const [answers, dictionary, ...bankContent] = await Promise.all([
    readFinalList(resolve(root, 'data/answers.txt')),
    readFinalList(resolve(root, 'data/dictionary.txt')),
    ...questionBanks.map((name) => readQuestionContent(resolve(root, 'data', name))),
  ]);
  const questionContent = bankContent.flat();
  const assets = await Promise.all(files.map((path) => readFile(path, 'utf8')));
  const allWords = [...answers, ...dictionary];
  const leaked = findLeakedWords(allWords, assets);
  if (leaked.length > 0)
    throw new Error(`Word-list content found in client assets: ${leaked.join(', ')}`);
  const leakedQuestions = findLeakedContent(questionContent, assets);
  if (leakedQuestions.length > 0)
    throw new Error(
      `Server-only quiz content found in client assets: ${leakedQuestions.join(', ')}`,
    );
  process.stdout.write(
    `Client leak check passed for ${new Set(allWords).size} finalized words and ${questionContent.length} server-only question strings from ${questionBanks.join(', ')}.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
