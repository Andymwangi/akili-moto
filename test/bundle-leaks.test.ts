import { describe, expect, it } from 'vitest';
import { findLeakedContent, findLeakedWords } from '../src/shared/lib/bundle-leaks';

describe('client answer leak check', () => {
  it('detects a fake fixture word when it appears in a client asset', () => {
    expect(findLeakedWords(['abcde', 'fghij'], ['const value="abcde";'])).toEqual(['abcde']);
  });

  it('does not report list words absent from all client assets', () => {
    expect(findLeakedWords(['abcde', 'fghij'], ['const message="Neno";'])).toEqual([]);
  });

  it('detects server-only quiz prompts and answers in a client asset', () => {
    expect(findLeakedContent(['Which planet is red?', 'Mars'], ['const answer="Mars";'])).toEqual([
      'Mars',
    ]);
  });
});
