import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useLayoutEffect, useState } from 'react';
import { QUIZ_SPEED_BONUS_WINDOW_SECONDS } from '../../shared/constants';
import type { QuizAnswer, QuizState } from '../../shared/schemas/quiz';
import {
  ApiClientError,
  getPlayerHistory,
  getPlayerProfile,
  getQuiz,
  getQuizLeaderboard,
  recoverPlayer,
  rotatePlayerRecoveryCode,
  submitQuizAnswer,
  updatePlayerName,
} from '../api';
import { persistTheme, resolveTheme } from '../theme';

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

const difficultyName: Record<NonNullable<QuizState['currentQuestion']>['difficulty'], string> = {
  medium: 'Medium',
  challenging: 'Challenging',
  hard: 'Hard',
  very_hard: 'Very hard',
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
  const [nameInput, setNameInput] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return resolveTheme(
      window.localStorage,
      window.matchMedia('(prefers-color-scheme: light)').matches,
    );
  });
  const profileQuery = useQuery({ queryKey: ['player'], queryFn: getPlayerProfile, staleTime: 0 });
  const quizQuery = useQuery({
    queryKey: ['quiz'],
    queryFn: getQuiz,
    staleTime: 0,
    enabled: Boolean(profileQuery.data),
  });
  const quiz = quizQuery.data;
  const profileDisplayName = profileQuery.data?.displayName;
  const currentAnswer = latestAnswer(quiz);
  const isFinished = quiz?.status === 'finished';
  const showingFeedback = Boolean(
    quiz && !isFinished && currentAnswer && feedbackIndex === currentAnswer.questionIndex,
  );
  const displayedQuestion = showingFeedback ? currentAnswer?.question : quiz?.currentQuestion;
  const displayedIndex = showingFeedback
    ? (currentAnswer?.questionIndex ?? quiz?.currentIndex ?? 0)
    : (quiz?.currentIndex ?? 0);
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
  const historyQuery = useInfiniteQuery({
    queryKey: ['player', 'history'],
    queryFn: ({ pageParam }) =>
      getPlayerHistory({ limit: 20, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
    enabled: Boolean(profileQuery.data),
    staleTime: 30_000,
  });
  const nameMutation = useMutation({
    mutationFn: () => updatePlayerName(nameInput),
    onSuccess: (profile) => {
      const current = queryClient.getQueryData<typeof profile>(['player']);
      queryClient.setQueryData(['player'], {
        ...profile,
        ...(current?.recoveryCode ? { recoveryCode: current.recoveryCode } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ['quiz', 'leaderboard'] });
      setProfileNotice('Your player name has been updated.');
    },
    onError: (error) => {
      setProfileNotice(
        error instanceof ApiClientError ? error.message : 'The name could not be saved.',
      );
    },
  });
  const recoveryCodeMutation = useMutation({
    mutationFn: rotatePlayerRecoveryCode,
    onSuccess: (profile) => {
      queryClient.setQueryData(['player'], profile);
      setProfileNotice('Save this new recovery code. Your previous code no longer works.');
    },
    onError: () => setProfileNotice('A new recovery code could not be created. Try again.'),
  });
  const recoverMutation = useMutation({
    mutationFn: () => recoverPlayer(recoveryInput),
    onSuccess: (profile) => {
      queryClient.removeQueries({ queryKey: ['quiz'] });
      queryClient.removeQueries({ queryKey: ['player', 'history'] });
      queryClient.setQueryData(['player'], profile);
      setRecoveryInput('');
      setProfileNotice('Your saved player identity has been restored on this device.');
      void queryClient.invalidateQueries({ queryKey: ['quiz'] });
      void queryClient.invalidateQueries({ queryKey: ['player', 'history'] });
    },
    onError: (error) => {
      setProfileNotice(
        error instanceof ApiClientError ? error.message : 'That recovery code was not recognized.',
      );
    },
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
    if (profileDisplayName) setNameInput(profileDisplayName);
  }, [profileDisplayName]);

  useEffect(() => {
    if (!quiz || quiz.status === 'finished' || quiz.answers.length === 0) return;
    setFeedbackIndex((current) => current ?? quiz.answers.at(-1)?.questionIndex ?? null);
  }, [quiz?.day, quiz?.answers.length, quiz?.status, quiz]);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f1e8' : '#172522');
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      persistTheme(window.localStorage, next);
      return next;
    });
  }

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
          <span className="daily-tag">10 questions</span>
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </div>
      </header>

      <section className="player-panel" aria-label="Player profile">
        {profileQuery.isPending && <p className="status-inline">Loading your player profile…</p>}
        {profileQuery.isError && (
          <div className="error-card" role="alert">
            Your profile could not load.
            <button type="button" onClick={() => void profileQuery.refetch()}>
              Retry
            </button>
          </div>
        )}
        {profileQuery.data && (
          <>
            <div className="player-profile-heading">
              <div>
                <span className="eyebrow">YOUR PLAYER ID</span>
                <strong className="player-id">{profileQuery.data.playerId}</strong>
              </div>
              <form
                className="name-form"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  nameMutation.mutate();
                }}
              >
                <label htmlFor="player-name">Player name</label>
                <div className="name-form-controls">
                  <input
                    id="player-name"
                    value={nameInput}
                    maxLength={24}
                    onChange={(event) => setNameInput(event.target.value)}
                    autoComplete="nickname"
                  />
                  <button
                    type="submit"
                    disabled={nameMutation.isPending || nameInput.trim().length < 2}
                  >
                    Save name
                  </button>
                </div>
              </form>
            </div>
            {profileNotice && (
              <p className="profile-notice" role="status">
                {profileNotice}
              </p>
            )}
            <div className="recovery-panel">
              <div>
                <strong>Keep your player identity</strong>
                <p>
                  Save this code privately. It restores this ID, name, and history on another
                  device; it is shown only when created or rotated.
                </p>
                {profileQuery.data.recoveryCode && (
                  <code className="recovery-code">{profileQuery.data.recoveryCode}</code>
                )}
              </div>
              <button
                type="button"
                onClick={() => recoveryCodeMutation.mutate()}
                disabled={recoveryCodeMutation.isPending}
              >
                {profileQuery.data.recoveryCode ? 'Create a new code' : 'Show a recovery code'}
              </button>
            </div>
            <details className="recover-form">
              <summary>Restore a different player identity</summary>
              <form
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  recoverMutation.mutate();
                }}
              >
                <label htmlFor="recovery-code-input">Recovery code</label>
                <div className="name-form-controls">
                  <input
                    id="recovery-code-input"
                    value={recoveryInput}
                    onChange={(event) => setRecoveryInput(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    disabled={recoverMutation.isPending || !recoveryInput.trim()}
                  >
                    Restore player
                  </button>
                </div>
              </form>
            </details>
          </>
        )}
      </section>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">A DAILY TEST OF KNOWLEDGE</p>
          <h1 id="page-title">Akili Moto</h1>
          <p className="intro-copy">Ten questions. One shared challenge. How high can you climb?</p>
        </div>
        <div className="hero-note" aria-hidden="true">
          <span>ONE SET</span>
          <strong>10</strong>
          <span>QUESTIONS</span>
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
                      <span className="leaderboard-player">{item.displayName}</span>
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
                  <span>QUESTION {String(displayedIndex + 1).padStart(2, '0')}</span>
                  <span>OF 10</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Quiz progress"
                  aria-valuemin={1}
                  aria-valuemax={10}
                  aria-valuenow={displayedIndex + 1}
                >
                  <span style={{ width: `${((displayedIndex + 1) / 10) * 100}%` }} />
                </div>
                <div className="question-submeta">
                  <span className={`language-pill language-${displayedQuestion?.language ?? 'en'}`}>
                    {displayedQuestion ? languageName[displayedQuestion.language] : 'Finished'}
                  </span>
                  {displayedQuestion && (
                    <span className={`difficulty-pill difficulty-${displayedQuestion.difficulty}`}>
                      {difficultyName[displayedQuestion.difficulty]}
                    </span>
                  )}
                  {!showingFeedback && (
                    <span className="speed-pill">
                      {speedBonusLeft > 0
                        ? `+${speedBonusLeft} speed pts`
                        : 'Accuracy still counts'}
                    </span>
                  )}
                </div>
              </div>

              {showingFeedback && currentAnswer ? (
                <div
                  className={
                    currentAnswer.isCorrect
                      ? 'answer-feedback is-correct'
                      : 'answer-feedback is-wrong'
                  }
                  role="status"
                  aria-live="polite"
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
                  <fieldset
                    className="option-list"
                    aria-labelledby="question-title"
                    disabled={answerMutation.isPending}
                  >
                    {quiz.currentQuestion?.options.map((option) => (
                      <button
                        className="option-button"
                        key={option.id}
                        type="button"
                        onClick={() => chooseOption(option.id)}
                        disabled={!quiz.currentQuestion}
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

      {profileQuery.data && (
        <section className="history-panel" aria-labelledby="history-title">
          <div className="leaderboard-heading">
            <div>
              <span className="eyebrow">YOUR RECORD</span>
              <h2 id="history-title">Previous games</h2>
            </div>
            <span>Most recent first</span>
          </div>
          {historyQuery.isPending && <p className="status-inline">Loading your history…</p>}
          {historyQuery.isError && (
            <div className="error-card" role="alert">
              Your game history is unavailable.
              <button type="button" onClick={() => void historyQuery.refetch()}>
                Retry
              </button>
            </div>
          )}
          {historyQuery.data?.pages.every((page) => page.items.length === 0) && (
            <p className="empty-state">Completed daily games will appear here.</p>
          )}
          {historyQuery.data?.pages.some((page) => page.items.length > 0) && (
            <ol className="history-list">
              {historyQuery.data.pages
                .flatMap((page) => page.items)
                .map((game) => (
                  <li key={game.day}>
                    <time dateTime={game.day}>{game.day}</time>
                    <span>{game.correctCount}/10 correct</span>
                    <strong>{game.score.toLocaleString()} pts</strong>
                  </li>
                ))}
            </ol>
          )}
          {historyQuery.hasNextPage && (
            <button
              className="history-more"
              type="button"
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => void historyQuery.fetchNextPage()}
            >
              {historyQuery.isFetchingNextPage ? 'Loading older games…' : 'Load older games'}
            </button>
          )}
        </section>
      )}

      <footer className="page-footer">
        A shared challenge, set at midnight in Nairobi. The leaderboard ranks completed games.
      </footer>
    </main>
  );
}
