import { describe, expect, it } from 'vitest';
import { persistTheme, resolveTheme } from '../src/client/theme';
import {
  QUIZ_ENGLISH_QUESTION_COUNT,
  QUIZ_QUESTION_COUNT,
  QUIZ_SWAHILI_QUESTION_COUNT,
} from '../src/shared/constants';
import {
  correctOptionId,
  questionBank,
  selectDailyQuestionIds,
  toPublicQuestion,
} from '../src/worker/lib/quiz/question-bank';
import { scoreQuizAnswer } from '../src/worker/lib/quiz/scoring';

describe('question bank composition', () => {
  it('keeps the 40-item, English-forward pool across the four levels', () => {
    expect(questionBank).toHaveLength(40);
    expect(questionBank.filter((question) => question.language === 'en')).toHaveLength(28);
    expect(questionBank.filter((question) => question.language === 'sw')).toHaveLength(12);
    expect(questionBank.filter((question) => question.difficulty === 'medium')).toHaveLength(10);
    expect(questionBank.filter((question) => question.difficulty === 'challenging')).toHaveLength(
      10,
    );
    expect(questionBank.filter((question) => question.difficulty === 'hard')).toHaveLength(10);
    expect(questionBank.filter((question) => question.difficulty === 'very_hard')).toHaveLength(10);
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
  it('selects ten unique questions in a progressive difficulty and language schedule', () => {
    const ids = selectDailyQuestionIds('2026-11-02');
    const questions = ids.map((id) => questionBank.find((question) => question.id === id));
    expect(ids).toHaveLength(QUIZ_QUESTION_COUNT);
    expect(new Set(ids).size).toBe(QUIZ_QUESTION_COUNT);
    expect(questions.filter((question) => question?.language === 'en')).toHaveLength(
      QUIZ_ENGLISH_QUESTION_COUNT,
    );
    expect(questions.filter((question) => question?.language === 'sw')).toHaveLength(
      QUIZ_SWAHILI_QUESTION_COUNT,
    );
    expect(questions.map((question) => question?.difficulty)).toEqual([
      'medium',
      'medium',
      'challenging',
      'challenging',
      'challenging',
      'hard',
      'hard',
      'hard',
      'very_hard',
      'very_hard',
    ]);
    expect(questions.map((question) => question?.language)).toEqual([
      'en',
      'en',
      'en',
      'sw',
      'en',
      'en',
      'sw',
      'en',
      'sw',
      'en',
    ]);
  });

  it('returns the same questions and option order to every player for one day', () => {
    const day = '2026-11-02';
    const firstIds = selectDailyQuestionIds(day);
    const secondIds = selectDailyQuestionIds(day);
    const question = questionBank.find((entry) => entry.id === firstIds[0]);
    if (!question) throw new Error('Question selection returned an unknown ID');
    expect(firstIds).toEqual(secondIds);
    expect(toPublicQuestion(question, day)).toEqual(toPublicQuestion(question, day));
  });

  it('never repeats a question within a daily set across many days', () => {
    for (let day = 1; day <= 31; day += 1) {
      const ids = selectDailyQuestionIds(`2026-11-${String(day).padStart(2, '0')}`);
      expect(new Set(ids).size, `day ${day}`).toBe(QUIZ_QUESTION_COUNT);
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

describe('quiz scoring', () => {
  it('awards correctness points and reduces the speed bonus to zero after twenty seconds', () => {
    expect(scoreQuizAnswer(true, 0)).toBe(120);
    expect(scoreQuizAnswer(true, 9_000)).toBe(111);
    expect(scoreQuizAnswer(true, 20_000)).toBe(100);
    expect(scoreQuizAnswer(true, 45_000)).toBe(100);
    expect(scoreQuizAnswer(false, 0)).toBe(0);
  });

  it('rejects invalid server timing values', () => {
    expect(() => scoreQuizAnswer(true, -1)).toThrow(RangeError);
    expect(() => scoreQuizAnswer(true, 1.2)).toThrow(RangeError);
  });
});
