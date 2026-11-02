import type { GameState } from '../shared/schemas/game';

const feedbackEmoji = {
  correct: '🟩',
  present: '🟨',
  absent: '⬛',
} as const;

export function buildShareText(game: GameState): string {
  const grid = game.attempts
    .map((attempt) => attempt.feedback.map((status) => feedbackEmoji[status]).join(''))
    .join('\n');
  return `${game.day} ${game.attempts.length}/${game.maxAttempts}\n${grid}`;
}
