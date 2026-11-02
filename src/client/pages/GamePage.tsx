import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { QUIZ_SPEED_BONUS_WINDOW_SECONDS } from '../../shared/constants';
import type { QuizAnswer, QuizState } from '../../shared/schemas/quiz';
import { ApiClientError, getQuiz, getQuizLeaderboard, submitQuizAnswer } from '../api';

type ChoiceId = 'a' | 'b' | 'c' | 'd';
type AnswerInput = Readonly<{
  questionId: string;
  selectedOptionId: ChoiceId;
  idempotencyKey: string;
}>;

const languageName: Record<'en' | 'sw', string> = {
  en: 'English question',
  sw: 'Swahili question',
};

function latestAnswer(quiz: QuizState | undefined): QuizAnswer | undefined {
  return quiz?.answers.at(-1);
}

function currentAnswerStreak(answers: QuizAnswer[]): number {
  let streak = 0;
  for (const answer of answers) {
    streak = answer.isCorrect ? streak + 1 : 0;
  }
  return streak;
}

function feedbackText(answer: QuizAnswer): string {
  return answer.isCorrect
    ? 'Correct. Keep the streak alive!'
    : 'Not quite. Lock in for the next one.';
}

export function GamePage() {
  const queryClient = useQueryClient();
  const [feedbackIndex, setFeedbackIndex] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [notice, setNotice] = useState('');
  const quizQuery = useQuery({ queryKey: ['quiz'], queryFn: getQuiz, staleTime: 0 });
  const quiz = quizQuery.data;
  const currentAnswer = latestAnswer(quiz);
  const isFinished = quiz?.status === 'finished';
  const showingFeedback = Boolean(
    quiz && !isFinished && currentAnswer && feedbackIndex === currentAnswer.questionIndex,
  );
  const elapsedSeconds = quiz?.currentQuestionOpenedAt
    ? Math.max(0, Math.floor((nowMs - new Date(quiz.currentQuestionOpenedAt).getTime()) / 1000))
    : 0;
  const speedBonusLeft = Math.max(0, QUIZ_SPEED_BONUS_WINDOW_SECONDS - elapsedSeconds);
  const leaderboardQuery = useQuery({
    queryKey: ['quiz', 'leaderboard'],
    queryFn: getQuizLeaderboard,
    enabled: Boolean(isFinished),
    staleTime: 30_000,
  });
  const answerMutation = useMutation({
    mutationFn: (input: AnswerInput) =>
      submitQuizAnswer(input.questionId, input.selectedOptionId, input.idempotencyKey),
    onSuccess: (nextQuiz) => {
      queryClient.setQueryData(['quiz'], nextQuiz);
      setFeedbackIndex(nextQuiz.answers.at(-1)?.questionIndex ?? null);
      setNotice('');
    },
    onError: (error) => {
      setNotice(
        error instanceof ApiClientError ? error.message : 'Could not save that answer. Try again.',
      );
      if (error instanceof ApiClientError && error.status === 409) {
        void quizQuery.refetch();
      }
    },
  });

  useEffect(() => {
    if (!quiz || quiz.status === 'finished' || showingFeedback || !quiz.currentQuestionOpenedAt) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quiz?.currentQuestionOpenedAt, quiz?.status, showingFeedback, quiz]);

  useEffect(() => {
    if (!quiz || quiz.status === 'finished' || quiz.answers.length === 0) return;
    setFeedbackIndex((current) => current ?? quiz.answers.at(-1)?.questionIndex ?? null);
  }, [quiz?.day, quiz?.answers.length, quiz?.status, quiz]);

  function chooseOption(optionId: ChoiceId) {
    const question = quiz?.currentQuestion;
    if (!question || isFinished || showingFeedback || answerMutation.isPending) return;
    setNotice('');
    answerMutation.mutate({
      questionId: question.id,
      selectedOptionId: optionId,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <a className="brand" href="/" aria-label="Akili Moto home">
          akili<span>moto</span>
        </a>
        <div className="header-actions">
          <span className="day-label">{quiz?.day ?? 'Daily challenge'}</span>
          <span className="daily-tag">10 Qs · Maswali 10</span>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">THE DAILY BRAIN RACE</p>
          <h1 id="page-title">Akili Moto</h1>
          <p className="intro-copy">Ten questions. One shared challenge. How high can you climb?</p>
        </div>
        <div className="hero-stamp" aria-hidden="true">
          <span>LEO</span>
          <strong>10</strong>
          <span>SWALI</span>
        </div>
      </section>

      {quizQuery.isPending && (
        <p className="status-card" role="status">
          Loading today’s challenge…
        </p>
      )}
      {quizQuery.isError && (
        <div className="status-card error-card" role="alert">
          The quiz could not load. Check your connection and try again.
          <button type="button" onClick={() => void quizQuery.refetch()}>
            Try again
          </button>
        </div>
      )}

      {quiz && (
        <>
          <section className="score-strip" aria-label="Your challenge score">
            <div className="score-card score-card-primary">
              <span className="score-label">YOUR TALLY</span>
              <strong>{quiz.score.toLocaleString()}</strong>
              <small>points</small>
            </div>
            <div className="score-card">
              <span className="score-label">CORRECT</span>
              <strong>
                {quiz.correctCount}
                <small> / 10</small>
              </strong>
              <small>answers</small>
            </div>
            <div className="score-card">
              <span className="score-label">COMBO</span>
              <strong>
                {currentAnswerStreak(quiz.answers)}
                <small>×</small>
              </strong>
              <small>in a row</small>
            </div>
          </section>

          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}

          {isFinished ? (
            <section className="finish-panel" aria-labelledby="finish-title">
              <p className="eyebrow">CHALLENGE COMPLETE</p>
              <h2 id="finish-title">
                {quiz.rank ? `You placed #${quiz.rank}` : 'You made the board'}
              </h2>
              <p>
                {quiz.correctCount} correct answers for {quiz.score.toLocaleString()} points among{' '}
                {quiz.completedPlayers ?? 0} finished players.
              </p>
              <div className="leaderboard-heading">
                <div>
                  <span className="eyebrow">TODAY’S FIELD</span>
                  <h3>Leaderboard</h3>
                </div>
                <span>
                  {leaderboardQuery.data?.totalPlayers ?? quiz.completedPlayers ?? 0} players
                </span>
              </div>
              {leaderboardQuery.isPending && <p className="status-inline">Loading rankings…</p>}
              {leaderboardQuery.isError && (
                <div className="error-card" role="alert">
                  Rankings are unavailable right now.
                  <button type="button" onClick={() => void leaderboardQuery.refetch()}>
                    Retry
                  </button>
                </div>
              )}
              {leaderboardQuery.data && leaderboardQuery.data.items.length === 0 && (
                <p className="empty-state">
                  You’re the first finisher today. Invite someone to chase your score.
                </p>
              )}
              {leaderboardQuery.data && leaderboardQuery.data.items.length > 0 && (
                <ol className="leaderboard-list" aria-label="Top quiz scores">
                  {leaderboardQuery.data.items.map((item) => (
                    <li className="leaderboard-row" key={item.position}>
                      <span className="leaderboard-rank">{item.rank}</span>
                      <span className="leaderboard-player">Player</span>
                      <span className="leaderboard-correct">{item.correctCount}/10 correct</span>
                      <strong>{item.score.toLocaleString()}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : (
            <section className="quiz-card" aria-labelledby="question-title">
              <div className="question-meta">
                <div className="progress-label">
                  <span>QUESTION {String(quiz.currentIndex + 1).padStart(2, '0')}</span>
                  <span>OF 10</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Quiz progress"
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={quiz.currentIndex}
                >
                  <span style={{ width: `${quiz.currentIndex * 10}%` }} />
                </div>
                <div className="question-submeta">
                  <span
                    lang={quiz.currentQuestion?.language ?? 'en'}
                    className={`language-pill language-${quiz.currentQuestion?.language ?? 'en'}`}
                  >
                    {quiz.currentQuestion
                      ? languageName[quiz.currentQuestion.language]
                      : 'Finished'}
                  </span>
                  <span className="speed-pill">
                    {speedBonusLeft > 0 ? `+${speedBonusLeft} speed pts` : 'Accuracy still counts'}
                  </span>
                </div>
              </div>

              {showingFeedback && currentAnswer ? (
                <div
                  className={
                    currentAnswer.isCorrect
                      ? 'answer-feedback is-correct'
                      : 'answer-feedback is-wrong'
                  }
                >
                  <span className="feedback-kicker">
                    {currentAnswer.isCorrect ? 'NICE ONE' : 'GOOD TRY'}
                  </span>
                  <h2>{feedbackText(currentAnswer)}</h2>
                  <p>
                    Answer:{' '}
                    <strong>
                      {
                        currentAnswer.question.options.find(
                          (option) => option.id === currentAnswer.correctOptionId,
                        )?.text
                      }
                    </strong>
                    {' · '}
                    {currentAnswer.points} points
                  </p>
                  <p className="explanation">{currentAnswer.explanation}</p>
                  <a href={currentAnswer.sourceUrl} target="_blank" rel="noreferrer">
                    Read the source
                  </a>
                  <button
                    className="continue-button"
                    type="button"
                    onClick={() => setFeedbackIndex(null)}
                  >
                    Next question <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : (
                <>
                  <h2
                    id="question-title"
                    className="question-prompt"
                    lang={quiz.currentQuestion?.language ?? 'en'}
                  >
                    {quiz.currentQuestion?.prompt ?? 'Preparing your next question…'}
                  </h2>
                  <fieldset className="option-list" aria-labelledby="question-title">
                    {quiz.currentQuestion?.options.map((option) => (
                      <button
                        className="option-button"
                        key={option.id}
                        type="button"
                        onClick={() => chooseOption(option.id)}
                        disabled={answerMutation.isPending || !quiz.currentQuestion}
                      >
                        <span className="option-letter">{option.id.toUpperCase()}</span>
                        <span>{option.text}</span>
                        <span className="option-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </button>
                    ))}
                  </fieldset>
                  {answerMutation.isPending && (
                    <p className="status-inline" role="status">
                      Locking in your answer…
                    </p>
                  )}
                  <p className="question-footnote">
                    Correct answer: 100 pts. Answer fast for up to 20 bonus points.
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}

      <footer className="page-footer">
        Same questions for everyone, decided at midnight in Nairobi. The board only ranks completed
        challenges.
      </footer>
    </main>
  );
}
