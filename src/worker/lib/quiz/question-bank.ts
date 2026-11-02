import { z } from 'zod';
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
  prompt: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(160)).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
});

export type QuestionBankEntry = z.infer<typeof QuestionBankEntrySchema>;

const entries = z.array(QuestionBankEntrySchema).parse(questionData);
const englishEntries = entries.filter((entry) => entry.language === 'en');
const swahiliEntries = entries.filter((entry) => entry.language === 'sw');

if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
  throw new Error('Quiz question IDs must be unique.');
}
if (
  englishEntries.length < QUIZ_ENGLISH_QUESTION_COUNT ||
  swahiliEntries.length < QUIZ_SWAHILI_QUESTION_COUNT
) {
  throw new Error('The quiz bank does not have enough questions for a daily challenge.');
}
for (const entry of entries) {
  if (new Set(entry.options.map((option) => option.toLocaleLowerCase())).size !== 4) {
    throw new Error(`Quiz question ${entry.id} must have four unique options.`);
  }
}

export const QUIZ_QUESTION_SET_VERSION = 'v1';
export const questionBank: readonly QuestionBankEntry[] = entries;

export function questionById(id: string): QuestionBankEntry | undefined {
  return questionBank.find((question) => question.id === id);
}

export function toPublicQuestion(question: QuestionBankEntry, day: string): QuizQuestion {
  const options = shuffle(question.options, createRandom(`${day}:${question.id}`));
  return {
    id: question.id,
    language: question.language,
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

export function selectDailyQuestionIds(day: string): string[] {
  const random = createRandom(day);
  const english = shuffle(englishEntries, random).slice(0, QUIZ_ENGLISH_QUESTION_COUNT);
  const swahili = shuffle(swahiliEntries, random).slice(0, QUIZ_SWAHILI_QUESTION_COUNT);
  const selected = shuffle([...english, ...swahili], random);
  if (selected.length !== QUIZ_QUESTION_COUNT) {
    throw new Error('The daily quiz did not select the required number of questions.');
  }
  return selected.map((question) => question.id);
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
