import { describe, expect, it } from 'vitest';
import { validateWordLists } from '../src/shared/lib/wordlists';

describe('word-list validator', () => {
  it('accepts valid fake fixture lists', () => {
    const result = validateWordLists({
      answers: 'abcde\nfghij\n',
      dictionary: 'abcde\nfghij\nklmno\n',
      blocklist: 'vwxyz\n',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects malformed, duplicate, missing and blocked entries', () => {
    const result = validateWordLists({
      answers: 'abcde\nabcde\nabcde1\n',
      dictionary: 'abcde\nabcde1\n',
      blocklist: 'abcde1\n',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'answers.txt:2: duplicate word',
        'answers.txt:3: invalid word shape',
        'answer appears in blocklist: abcde1',
        'dictionary word appears in blocklist: abcde1',
      ]),
    );
  });

  it('rejects an answer absent from the allowed dictionary', () => {
    const result = validateWordLists({ answers: 'abcde\n', dictionary: 'fghij\n', blocklist: '' });
    expect(result.errors).toContain('answer missing from dictionary: abcde');
  });
});
