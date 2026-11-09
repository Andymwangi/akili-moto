import { describe, expect, it } from 'vitest';
import { persistTheme, resolveTheme } from '../src/client/theme';
import {
  QUIZ_ENGLISH_QUESTION_COUNT,
  QUIZ_QUESTION_COUNT,
  QUIZ_SWAHILI_QUESTION_COUNT,
} from '../src/shared/constants';
import {
  bonusQuestionIndex,
  correctOptionId,
  questionBank,
  questionById,
  selectDailyQuestionIds,
  selectDailyQuestionPair,
  toPublicQuestion,
} from '../src/worker/lib/quiz/question-bank';
import { isWithinAnswerWindow, scoreQuizAnswer } from '../src/worker/lib/quiz/scoring';

function dayString(offset: number): string {
  return new Date(Date.UTC(2026, 10, 1) + offset * 86_400_000).toISOString().slice(0, 10);
}

describe('question bank composition', () => {
  it('has enough tagged medium-to-hard questions to avoid repeats for several days', () => {
    expect(questionBank.every((question) => question.topic)).toBe(true);
    expect(questionBank.some((question) => question.difficulty === 'very_hard')).toBe(false);
    const dailyNeed: Record<string, number> = {
      'medium:en': 8,
      'medium:sw': 4,
      'challenging:en': 12,
      'challenging:sw': 2,
      'hard:en': 2,
      'hard:sw': 2,
    };
    for (const [key, perDay] of Object.entries(dailyNeed)) {
      const available = questionBank.filter(
        (question) => `${question.difficulty}:${question.language}` === key,
      ).length;
      expect(available, key).toBeGreaterThanOrEqual(perDay * 4);
    }
  });
});

describe('theme preference', () => {
  it('uses saved mode first and otherwise follows the system preference', () => {
    const storage = { getItem: () => 'dark', setItem: () => undefined };
    expect(resolveTheme(storage, true)).toBe('dark');
    expect(resolveTheme({ getItem: () => null, setItem: () => undefined }, true)).toBe('light');
    expect(resolveTheme({ getItem: () => 'corrupt', setItem: () => undefined }, false)).toBe(
      'dark',
    );
  });

  it('persists an explicit mode choice', () => {
    let saved: string | null = null;
    persistTheme(
      {
        getItem: () => saved,
        setItem: (_key, value) => {
          saved = value;
        },
      },
      'light',
    );
    expect(saved).toBe('light');
  });
});

describe('daily quiz selection', () => {
  it('selects fifteen questions in a progressive difficulty and language schedule', () => {
    const ids = selectDailyQuestionIds('2026-11-02');
    const questions = ids.map((id) => questionById(id));
    expect(ids).toHaveLength(QUIZ_QUESTION_COUNT);
    expect(new Set(ids).size).toBe(QUIZ_QUESTION_COUNT);
    expect(questions.filter((question) => question?.language === 'en')).toHaveLength(
      QUIZ_ENGLISH_QUESTION_COUNT,
    );
    expect(questions.filter((question) => question?.language === 'sw')).toHaveLength(
      QUIZ_SWAHILI_QUESTION_COUNT,
    );
    expect(questions.map((question) => question?.difficulty)).toEqual([
      ...Array(6).fill('medium'),
      ...Array(7).fill('challenging'),
      ...Array(2).fill('hard'),
    ]);
  });

  it('returns the same questions and option order to every player for one day', () => {
    const day = '2026-11-02';
    const firstIds = selectDailyQuestionIds(day);
    const secondIds = selectDailyQuestionIds(day);
    const question = questionById(firstIds[0] ?? '');
    if (!question) throw new Error('Question selection returned an unknown ID');
    expect(firstIds).toEqual(secondIds);
    expect(toPublicQuestion(question, day)).toEqual(toPublicQuestion(question, day));
  });

  it('produces a valid, disjoint, topic-balanced pair for every day of a year', () => {
    for (let offset = 0; offset < 365; offset += 1) {
      const day = dayString(offset);
      const [first, second] = selectDailyQuestionPair(day);
      expect(new Set([...first, ...second]).size, day).toBe(QUIZ_QUESTION_COUNT * 2);
      for (const ids of [first, second]) {
        const topics = ids.map((id) => questionById(id)?.topic);
        const counts = new Map<string | undefined, number>();
        for (const topic of topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
        expect(counts.size, day).toBeGreaterThanOrEqual(7);
        expect(Math.max(...counts.values()), day).toBeLessThanOrEqual(2);
      }
    }
  });

  it('avoids questions used on the previous three days', () => {
    const history: string[][] = [];
    for (let offset = 0; offset < 60; offset += 1) {
      const avoid = new Set(history.slice(-3).flat());
      const pair = selectDailyQuestionPair(dayString(offset), 0, avoid);
      const ids = [...pair[0], ...pair[1]];
      expect(
        ids.filter((id) => avoid.has(id)),
        dayString(offset),
      ).toEqual([]);
      history.push(ids);
    }
  });

  it('keeps answer keys out of the public question shape', () => {
    const entry = questionBank[0];
    if (!entry) throw new Error('Question bank is empty');
    const publicQuestion = toPublicQuestion(entry, '2026-11-02');
    expect(publicQuestion).not.toHaveProperty('correctOptionId');
    expect(publicQuestion).not.toHaveProperty('correctOptionIndex');
    expect(publicQuestion).not.toHaveProperty('explanation');
    expect(publicQuestion).not.toHaveProperty('sourceUrl');
    expect(publicQuestion.difficulty).toBe(entry.difficulty);
    const correctId = correctOptionId(entry, '2026-11-02');
    expect(publicQuestion.options.find((option) => option.id === correctId)?.text).toBe(
      entry.options[entry.correctOptionIndex],
    );
  });
});

describe('bonus question', () => {
  it('picks one stable in-range question per 15-question round', () => {
    const [first, second] = selectDailyQuestionPair('2026-11-02');
    const indexOne = bonusQuestionIndex('2026-11-02', 1, first);
    expect(indexOne).toBe(bonusQuestionIndex('2026-11-02', 1, first));
    expect(indexOne).toBeGreaterThanOrEqual(0);
    expect(indexOne).toBeLessThan(QUIZ_QUESTION_COUNT);
    expect(bonusQuestionIndex('2026-11-02', 2, second)).toBeDefined();
  });

  it('lands on different positions across days', () => {
    const positions = new Set(
      Array.from({ length: 60 }, (_, offset) => {
        const day = dayString(offset);
        return bonusQuestionIndex(day, 1, selectDailyQuestionPair(day)[0]);
      }),
    );
    expect(positions.size).toBeGreaterThan(8);
  });

  it('is absent for legacy ten-question rounds', () => {
    expect(bonusQuestionIndex('2026-11-02', 1, Array(10).fill('q'))).toBeUndefined();
  });
});

describe('quiz scoring', () => {
  it('declines from 200 to 100 points over the 30-second timer', () => {
    expect(scoreQuizAnswer(true, 0)).toBe(200);
    expect(scoreQuizAnswer(true, 15_000)).toBe(150);
    expect(scoreQuizAnswer(true, 29_999)).toBe(100);
    expect(scoreQuizAnswer(false, 0)).toBe(0);
  });

  it('scores answers in the network grace window at the minimum and rejects later ones', () => {
    expect(isWithinAnswerWindow(30_000)).toBe(true);
    expect(scoreQuizAnswer(true, 30_000)).toBe(100);
    expect(scoreQuizAnswer(true, 31_499)).toBe(100);
    expect(isWithinAnswerWindow(31_500)).toBe(false);
    expect(scoreQuizAnswer(true, 31_500)).toBe(0);
  });

  it('doubles points on the bonus question only when correct', () => {
    expect(scoreQuizAnswer(true, 0, true)).toBe(400);
    expect(scoreQuizAnswer(true, 15_000, true)).toBe(300);
    expect(scoreQuizAnswer(false, 0, true)).toBe(0);
  });

  it('rejects invalid server timing values', () => {
    expect(() => scoreQuizAnswer(true, -1)).toThrow(RangeError);
    expect(() => scoreQuizAnswer(true, 1.2)).toThrow(RangeError);
  });
});
