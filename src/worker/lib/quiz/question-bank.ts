import { z } from 'zod';
import legacyQuestionData from '../../../../data/legacy-quiz-questions-v1.json';
import questionData from '../../../../data/quiz-questions.json';
import {
  QUIZ_ENGLISH_QUESTION_COUNT,
  QUIZ_QUESTION_COUNT,
  QUIZ_SWAHILI_QUESTION_COUNT,
} from '../../../shared/constants';
import type { QuizQuestion } from '../../../shared/schemas/quiz';

const QuestionBankEntrySchema = z.strictObject({
  id: z.string().min(1).max(64),
  language: z.enum(['en', 'sw']),
  difficulty: z.enum(['medium', 'challenging', 'hard', 'very_hard']),
  prompt: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(160)).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
});

export type QuestionBankEntry = z.infer<typeof QuestionBankEntrySchema>;

const entries = z.array(QuestionBankEntrySchema).parse(questionData);
const legacyEntries = z.array(QuestionBankEntrySchema).parse(legacyQuestionData);
const allEntries = [...entries, ...legacyEntries];

if (new Set(allEntries.map((entry) => entry.id)).size !== allEntries.length) {
  throw new Error('Quiz question IDs must be unique.');
}
const dailySlots: ReadonlyArray<
  readonly [QuestionBankEntry['difficulty'], QuestionBankEntry['language']]
> = [
  ['medium', 'en'],
  ['medium', 'en'],
  ['challenging', 'en'],
  ['challenging', 'sw'],
  ['challenging', 'en'],
  ['hard', 'en'],
  ['hard', 'sw'],
  ['hard', 'en'],
  ['very_hard', 'sw'],
  ['very_hard', 'en'],
];
for (const [index, [difficulty, language]] of dailySlots.entries()) {
  if (dailySlots.findIndex(([level, lang]) => level === difficulty && lang === language) !== index)
    continue;
  const required = dailySlots.filter(
    ([level, lang]) => level === difficulty && lang === language,
  ).length;
  const available = entries.filter(
    (entry) => entry.difficulty === difficulty && entry.language === language,
  ).length;
  if (available < required)
    throw new Error(`The quiz bank needs ${required} ${difficulty} ${language} questions.`);
}
for (const entry of allEntries) {
  if (new Set(entry.options.map((option) => option.toLocaleLowerCase())).size !== 4) {
    throw new Error(`Quiz question ${entry.id} must have four unique options.`);
  }
}

export const QUIZ_QUESTION_SET_VERSION = 'v3';
export const questionBank: readonly QuestionBankEntry[] = entries;

export function questionById(id: string): QuestionBankEntry | undefined {
  return allEntries.find((question) => question.id === id);
}

export function toPublicQuestion(question: QuestionBankEntry, day: string): QuizQuestion {
  const options = shuffle(question.options, createRandom(`${day}:${question.id}`));
  return {
    id: question.id,
    language: question.language,
    difficulty: question.difficulty,
    prompt: question.prompt,
    options: options.map((text, index) => ({
      id: choiceId(index),
      text,
    })),
  };
}

export function correctOptionId(question: QuestionBankEntry, day: string): 'a' | 'b' | 'c' | 'd' {
  const options = shuffle(question.options, createRandom(`${day}:${question.id}`));
  const correctText = question.options[question.correctOptionIndex];
  if (correctText === undefined) throw new Error(`Missing answer for question ${question.id}.`);
  const correctIndex = options.indexOf(correctText);
  if (correctIndex < 0) throw new Error(`Missing correct answer for question ${question.id}.`);
  return choiceId(correctIndex);
}

export function selectDailyQuestionIds(day: string, variant = 0): string[] {
  const buckets = new Map<string, QuestionBankEntry[]>();
  const selected = dailySlots.map(([difficulty, language]) => {
    const bucketKey = `${difficulty}:${language}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      const candidates = entries.filter(
        (entry) => entry.difficulty === difficulty && entry.language === language,
      );
      bucket = shuffle(candidates, createRandom(`${day}:${variant}:${bucketKey}`));
      buckets.set(bucketKey, bucket);
    }
    const question = bucket.shift();
    if (!question) throw new Error(`No question available for ${difficulty} ${language} slot.`);
    return question.id;
  });
  if (
    selected.length !== QUIZ_QUESTION_COUNT ||
    dailySlots.filter(([, language]) => language === 'en').length !== QUIZ_ENGLISH_QUESTION_COUNT ||
    dailySlots.filter(([, language]) => language === 'sw').length !== QUIZ_SWAHILI_QUESTION_COUNT
  ) {
    throw new Error('The daily quiz does not match the required question schedule.');
  }
  return selected;
}

function choiceId(index: number): 'a' | 'b' | 'c' | 'd' {
  const ids = ['a', 'b', 'c', 'd'] as const;
  const id = ids[index];
  if (!id) throw new RangeError('Choice index is out of range.');
  return id;
}

function createRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (const character of seedText) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    const swap = result[swapIndex];
    if (current === undefined || swap === undefined) throw new RangeError('Invalid shuffle index.');
    result[index] = swap;
    result[swapIndex] = current;
  }
  return result;
}
