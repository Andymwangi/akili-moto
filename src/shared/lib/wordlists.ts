const WORD_PATTERN = /^[a-z]{5}$/;

export type WordListFiles = Readonly<{
  answers: string;
  dictionary: string;
  blocklist: string;
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  errors: string[];
  answerCount: number;
  dictionaryCount: number;
}>;

function parseWords(contents: string, name: string, errors: string[]): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const word = line.split('#', 1)[0]?.trim() ?? '';
    if (!word) continue;
    if (!WORD_PATTERN.test(word)) errors.push(`${name}:${index + 1}: invalid word shape`);
    if (seen.has(word)) errors.push(`${name}:${index + 1}: duplicate word`);
    seen.add(word);
    words.push(word);
  }
  return words;
}

export function validateWordLists(files: WordListFiles): ValidationResult {
  const errors: string[] = [];
  const answers = parseWords(files.answers, 'answers.txt', errors);
  const dictionary = parseWords(files.dictionary, 'dictionary.txt', errors);
  const blocklist = new Set(parseWords(files.blocklist, 'blocklist.txt', errors));
  const allowed = new Set(dictionary);

  if (answers.length === 0) errors.push('answers.txt: no words found');
  if (dictionary.length === 0) errors.push('dictionary.txt: no words found');
  for (const answer of answers) {
    if (!allowed.has(answer)) errors.push(`answer missing from dictionary: ${answer}`);
    if (blocklist.has(answer)) errors.push(`answer appears in blocklist: ${answer}`);
  }
  for (const word of allowed) {
    if (blocklist.has(word)) errors.push(`dictionary word appears in blocklist: ${word}`);
  }

  return {
    valid: errors.length === 0 && answers.length > 0 && dictionary.length > 0,
    errors,
    answerCount: answers.length,
    dictionaryCount: dictionary.length,
  };
}
