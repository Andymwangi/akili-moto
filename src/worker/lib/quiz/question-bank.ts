import { z } from 'zod';
import legacyQuestionData from '../../../../data/legacy-quiz-questions-v1.json';
import questionData from '../../../../data/quiz-questions.json';
import currentQuestionData from '../../../../data/quiz-questions-v4.json';
import nextQuestionData from '../../../../data/quiz-questions-v5.json';
import {
  QUIZ_ENGLISH_QUESTION_COUNT,
  QUIZ_QUESTION_COUNT,
  QUIZ_SWAHILI_QUESTION_COUNT,
} from '../../../shared/constants';
import type { QuizQuestion } from '../../../shared/schemas/quiz';

const SELECTION_ATTEMPTS = 32;
const ROUND_DIFFICULTY_MIX = { medium: 6, challenging: 7, hard: 2 } as const;

export const QuestionTopicSchema = z.enum([
  'art',
  'culture',
  'economics',
  'environment',
  'geography',
  'history',
  'literature',
  'mathematics',
  'music',
  'science',
  'technology',
  'sports',
  'language',
  'health',
  'film',
]);
export type QuestionTopic = z.infer<typeof QuestionTopicSchema>;

const QuestionBankEntrySchema = z.strictObject({
  id: z.string().min(1).max(64),
  language: z.enum(['en', 'sw']),
  difficulty: z.enum(['medium', 'challenging', 'hard', 'very_hard']),
  topic: QuestionTopicSchema.optional(),
  prompt: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(160)).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
});

export type QuestionBankEntry = z.infer<typeof QuestionBankEntrySchema>;

const currentEntries = z.array(QuestionBankEntrySchema).parse(currentQuestionData);
const nextEntries = z.array(QuestionBankEntrySchema).parse(nextQuestionData);
const previousEntries = z.array(QuestionBankEntrySchema).parse(questionData);
const legacyEntries = z.array(QuestionBankEntrySchema).parse(legacyQuestionData);
const allEntries = [...nextEntries, ...currentEntries, ...previousEntries, ...legacyEntries];
const activeEntries = [
  ...currentEntries.filter((entry) => entry.difficulty !== 'very_hard'),
  ...nextEntries,
];
const activeIds = new Set(activeEntries.map((entry) => entry.id));
const entriesById = new Map(allEntries.map((entry) => [entry.id, entry]));

if (new Set(allEntries.map((entry) => entry.id)).size !== allEntries.length) {
  throw new Error('Quiz question IDs must be unique.');
}

// Progressive order: six medium, seven challenging, two hard; 11 English and 4 Swahili.
const dailySlots: ReadonlyArray<
  readonly [QuestionBankEntry['difficulty'], QuestionBankEntry['language']]
> = [
  ['medium', 'en'],
  ['medium', 'en'],
  ['medium', 'sw'],
  ['medium', 'en'],
  ['medium', 'sw'],
  ['medium', 'en'],
  ['challenging', 'en'],
  ['challenging', 'en'],
  ['challenging', 'sw'],
  ['challenging', 'en'],
  ['challenging', 'en'],
  ['challenging', 'en'],
  ['challenging', 'en'],
  ['hard', 'en'],
  ['hard', 'sw'],
];

for (const [index, [difficulty, language]] of dailySlots.entries()) {
  if (dailySlots.findIndex(([level, lang]) => level === difficulty && lang === language) !== index)
    continue;
  const requiredForTwoRounds =
    dailySlots.filter(([level, lang]) => level === difficulty && lang === language).length * 2;
  const available = activeEntries.filter(
    (entry) => entry.difficulty === difficulty && entry.language === language,
  ).length;
  if (available < requiredForTwoRounds) {
    throw new Error(
      `The v5 quiz bank needs ${requiredForTwoRounds} ${difficulty} ${language} questions for two rounds.`,
    );
  }
}

for (const entry of allEntries) {
  if (new Set(entry.options.map((option) => option.toLocaleLowerCase())).size !== 4) {
    throw new Error(`Quiz question ${entry.id} must have four unique options.`);
  }
}

export const QUIZ_QUESTION_SET_VERSION = 'v5';
export const questionBank: readonly QuestionBankEntry[] = activeEntries;

export function questionById(id: string): QuestionBankEntry | undefined {
  return entriesById.get(id);
}

export function toPublicQuestion(question: QuestionBankEntry, day: string): QuizQuestion {
  const options = shuffle(question.options, createRandom(`${day}:${question.id}`));
  return {
    id: question.id,
    language: question.language,
    difficulty: question.difficulty,
    prompt: question.prompt,
    options: options.map((text, index) => ({ id: choiceId(index), text })),
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

/**
 * Picks two disjoint rounds for a day. The result is deterministic for the same
 * day, variant, and avoid set, so concurrent requests agree on the same pair.
 * Questions in `avoid` (recently used) are excluded outright first; only if no
 * attempt can fill every slot without them are they allowed back as a fallback.
 */
export function selectDailyQuestionPair(
  day: string,
  variant = 0,
  avoid: ReadonlySet<string> = new Set(),
): [string[], string[]] {
  for (const strict of [true, false]) {
    for (let attempt = 0; attempt < SELECTION_ATTEMPTS; attempt += 1) {
      const pair = tryBuildPair(`${day}:v5:${variant}:${attempt}`, avoid, strict);
      if (pair) return pair;
    }
  }
  throw new Error('DAILY_QUIZ_SELECTION_FAILED');
}

function tryBuildPair(
  seed: string,
  avoid: ReadonlySet<string>,
  strict: boolean,
): [string[], string[]] | undefined {
  const ids: [string[], string[]] = [[], []];
  const topicCounts: [Map<QuestionTopic, number>, Map<QuestionTopic, number>] = [
    new Map(),
    new Map(),
  ];
  const selected = new Set<string>();

  for (const [slotIndex, [difficulty, language]] of dailySlots.entries()) {
    for (const roundIndex of [0, 1] as const) {
      const available = shuffle(
        activeEntries.filter(
          (entry) =>
            entry.difficulty === difficulty &&
            entry.language === language &&
            !selected.has(entry.id),
        ),
        createRandom(`${seed}:${slotIndex}:${roundIndex}`),
      );
      const otherRoundTopic = questionById(ids[1 - roundIndex]?.[slotIndex] ?? '')?.topic;
      const eligible = available.filter(
        (entry) => entry.topic !== undefined && (topicCounts[roundIndex].get(entry.topic) ?? 0) < 2,
      );
      const fresh = eligible.filter((entry) => !avoid.has(entry.id));
      const preferred = fresh.length > 0 || strict ? fresh : eligible;
      const distinct = preferred.filter((entry) => entry.topic !== otherRoundTopic);
      const candidates = distinct.length > 0 ? distinct : preferred;
      if (candidates.length === 0) return undefined;

      const fewestUses = Math.min(
        ...candidates.map(
          (entry) => topicCounts[roundIndex].get(entry.topic as QuestionTopic) ?? 0,
        ),
      );
      const chosen = candidates.find(
        (entry) => (topicCounts[roundIndex].get(entry.topic as QuestionTopic) ?? 0) === fewestUses,
      );
      if (!chosen?.topic) return undefined;
      ids[roundIndex].push(chosen.id);
      selected.add(chosen.id);
      topicCounts[roundIndex].set(
        chosen.topic,
        (topicCounts[roundIndex].get(chosen.topic) ?? 0) + 1,
      );
    }
  }

  try {
    validateDailyQuestionPair(ids);
  } catch {
    return undefined;
  }
  return ids;
}

/**
 * One question per 15-question round earns the bonus multiplier. It is derived from
 * the stored assignment, so every player gets the same bonus question all day.
 * Legacy 10-question rounds have no bonus.
 */
export function bonusQuestionIndex(
  day: string,
  round: 1 | 2,
  questionIds: readonly string[],
): number | undefined {
  if (questionIds.length !== QUIZ_QUESTION_COUNT) return undefined;
  const random = createRandom(`${day}:bonus:${round}:${questionIds.join(',')}`);
  return Math.floor(random() * QUIZ_QUESTION_COUNT);
}

export function selectDailyQuestionIds(day: string, variant = 0): string[] {
  return selectDailyQuestionPair(day, variant)[0];
}

export function validateDailyQuestionPair(pair: readonly [string[], string[]]): void {
  for (const ids of pair) {
    if (ids.length !== QUIZ_QUESTION_COUNT || ids.some((id) => !activeIds.has(id))) {
      throw new Error('INVALID_DAILY_QUIZ');
    }
    const questions = ids.map((id) => questionById(id));
    const topics = new Set(
      questions.flatMap((question) => (question?.topic ? [question.topic] : [])),
    );
    const topicCounts = questions.reduce((counts, question) => {
      if (question?.topic) counts.set(question.topic, (counts.get(question.topic) ?? 0) + 1);
      return counts;
    }, new Map<QuestionTopic, number>());
    const isTaggedRound = questions.every((question) => question?.topic !== undefined);
    if (
      isTaggedRound &&
      (topics.size < 7 || [...topicCounts.values()].some((count) => count > 2))
    ) {
      throw new Error('The daily round does not have a balanced topic mix.');
    }
    if (
      questions.filter((question) => question?.language === 'en').length !==
        QUIZ_ENGLISH_QUESTION_COUNT ||
      questions.filter((question) => question?.language === 'sw').length !==
        QUIZ_SWAHILI_QUESTION_COUNT
    ) {
      throw new Error('The daily round does not match the required language schedule.');
    }
    const countOf = (level: QuestionBankEntry['difficulty']) =>
      questions.filter((question) => question?.difficulty === level).length;
    if (
      countOf('medium') !== ROUND_DIFFICULTY_MIX.medium ||
      countOf('challenging') !== ROUND_DIFFICULTY_MIX.challenging ||
      countOf('hard') !== ROUND_DIFFICULTY_MIX.hard
    ) {
      throw new Error('The daily round does not match the medium-to-hard difficulty schedule.');
    }
  }

  if (new Set([...pair[0], ...pair[1]]).size !== QUIZ_QUESTION_COUNT * 2) {
    throw new Error('Daily rounds must not reuse questions.');
  }
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
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target] as T, result[index] as T];
  }
  return result;
}
