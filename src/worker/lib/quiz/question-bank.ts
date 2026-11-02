import { z } from 'zod';
import legacyQuestionData from '../../../../data/legacy-quiz-questions-v1.json';
import questionData from '../../../../data/quiz-questions.json';
import currentQuestionData from '../../../../data/quiz-questions-v4.json';
import {
  QUIZ_ENGLISH_QUESTION_COUNT,
  QUIZ_QUESTION_COUNT,
  QUIZ_SWAHILI_QUESTION_COUNT,
} from '../../../shared/constants';
import type { QuizQuestion } from '../../../shared/schemas/quiz';

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
const previousEntries = z.array(QuestionBankEntrySchema).parse(questionData);
const legacyEntries = z.array(QuestionBankEntrySchema).parse(legacyQuestionData);
const allEntries = [...currentEntries, ...previousEntries, ...legacyEntries];

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
  const requiredForTwoRounds =
    dailySlots.filter(([level, lang]) => level === difficulty && lang === language).length * 2;
  const available = currentEntries.filter(
    (entry) => entry.difficulty === difficulty && entry.language === language,
  ).length;
  if (available < requiredForTwoRounds) {
    throw new Error(
      `The v4 quiz bank needs ${requiredForTwoRounds} ${difficulty} ${language} questions for two rounds.`,
    );
  }
}

for (const entry of allEntries) {
  if (new Set(entry.options.map((option) => option.toLocaleLowerCase())).size !== 4) {
    throw new Error(`Quiz question ${entry.id} must have four unique options.`);
  }
}

export const QUIZ_QUESTION_SET_VERSION = 'v4';
export const questionBank: readonly QuestionBankEntry[] = currentEntries;

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

export function selectDailyQuestionPair(day: string, variant = 0): [string[], string[]] {
  const ids: [string[], string[]] = [[], []];
  const topicCounts: [Map<QuestionTopic, number>, Map<QuestionTopic, number>] = [
    new Map(),
    new Map(),
  ];
  const selected = new Set<string>();

  dailySlots.forEach(([difficulty, language], slotIndex) => {
    for (const roundIndex of [0, 1] as const) {
      const candidates = currentEntries.filter(
        (entry) => entry.difficulty === difficulty && entry.language === language,
      );
      const available = shuffle(
        candidates.filter((entry) => !selected.has(entry.id)),
        createRandom(`${day}:v4:${variant}:${difficulty}:${language}:${slotIndex}:${roundIndex}`),
      );
      const otherRound = (1 - roundIndex) as 0 | 1;
      const otherRoundTopic = ids[otherRound][slotIndex]
        ? questionById(ids[otherRound][slotIndex] ?? '')?.topic
        : undefined;
      const eligible = available.filter((entry) => {
        const topic = entry.topic;
        return topic !== undefined && (topicCounts[roundIndex].get(topic) ?? 0) < 2;
      });
      const distinctFromOtherRound = eligible.filter((entry) => entry.topic !== otherRoundTopic);
      const candidatesForSlot =
        distinctFromOtherRound.length > 0 ? distinctFromOtherRound : eligible;
      if (candidatesForSlot.length === 0) {
        throw new Error(`No disjoint question available for ${difficulty} ${language} round slot.`);
      }

      const fewestUses = Math.min(
        ...candidatesForSlot.map(
          (entry) => topicCounts[roundIndex].get(entry.topic as QuestionTopic) ?? 0,
        ),
      );
      const chosen = candidatesForSlot.find(
        (entry) => (topicCounts[roundIndex].get(entry.topic as QuestionTopic) ?? 0) === fewestUses,
      );
      if (!chosen?.topic) throw new Error('Question topic is required for new daily rounds.');
      ids[roundIndex].push(chosen.id);
      selected.add(chosen.id);
      topicCounts[roundIndex].set(
        chosen.topic,
        (topicCounts[roundIndex].get(chosen.topic) ?? 0) + 1,
      );
    }
  });

  validateDailyQuestionPair(ids);
  return ids;
}

export function selectDailyQuestionIds(day: string, variant = 0): string[] {
  return selectDailyQuestionPair(day, variant)[0];
}

export function validateDailyQuestionPair(pair: readonly [string[], string[]]): void {
  for (const ids of pair) {
    if (ids.length !== QUIZ_QUESTION_COUNT || ids.some((id) => !questionById(id))) {
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
