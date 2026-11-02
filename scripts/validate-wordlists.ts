import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateWordLists } from '../src/shared/lib/wordlists';

export { validateWordLists } from '../src/shared/lib/wordlists';

async function main(): Promise<void> {
  const directory = resolve(process.argv[2] ?? 'data');
  try {
    const [answers, dictionary, blocklist] = await Promise.all([
      readFile(resolve(directory, 'answers.txt'), 'utf8'),
      readFile(resolve(directory, 'dictionary.txt'), 'utf8'),
      readFile(resolve(directory, 'blocklist.txt'), 'utf8'),
    ]);
    const result = validateWordLists({ answers, dictionary, blocklist });
    if (!result.valid) {
      process.stderr.write(`${result.errors.join('\n')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `Valid word lists: ${result.answerCount} answers, ${result.dictionaryCount} guesses.\n`,
    );
  } catch (error) {
    const message =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'Missing required word-list file.'
        : error instanceof Error
          ? error.message
          : 'Word-list validation failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
