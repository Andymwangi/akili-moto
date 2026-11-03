PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quiz_round_answers` (
	`day` text NOT NULL,
	`player_id` text NOT NULL,
	`round_no` integer NOT NULL,
	`question_index` integer NOT NULL,
	`question_id` text NOT NULL,
	`selected_option_id` text,
	`correct_option_id` text NOT NULL,
	`is_correct` integer NOT NULL,
	`points` integer NOT NULL,
	`response_ms` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`day`, `player_id`, `round_no`, `question_index`),
	CONSTRAINT "quiz_round_answers_round_range" CHECK("__new_quiz_round_answers"."round_no" BETWEEN 1 AND 2),
	CONSTRAINT "quiz_round_answers_question_index_range" CHECK("__new_quiz_round_answers"."question_index" BETWEEN 0 AND 14),
	CONSTRAINT "quiz_round_answers_option_id_range" CHECK("__new_quiz_round_answers"."selected_option_id" IS NULL OR "__new_quiz_round_answers"."selected_option_id" IN ('a', 'b', 'c', 'd')),
	CONSTRAINT "quiz_round_answers_correct_option_id_range" CHECK("__new_quiz_round_answers"."correct_option_id" IN ('a', 'b', 'c', 'd')),
	CONSTRAINT "quiz_round_answers_points_range" CHECK("__new_quiz_round_answers"."points" BETWEEN 0 AND 200),
	CONSTRAINT "quiz_round_answers_response_ms_range" CHECK("__new_quiz_round_answers"."response_ms" BETWEEN 0 AND 86400000)
);
--> statement-breakpoint
INSERT INTO `__new_quiz_round_answers`("day", "player_id", "round_no", "question_index", "question_id", "selected_option_id", "correct_option_id", "is_correct", "points", "response_ms", "idempotency_key", "submitted_at") SELECT "day", "player_id", "round_no", "question_index", "question_id", "selected_option_id", "correct_option_id", "is_correct", "points", "response_ms", "idempotency_key", "submitted_at" FROM `quiz_round_answers`;--> statement-breakpoint
DROP TABLE `quiz_round_answers`;--> statement-breakpoint
ALTER TABLE `__new_quiz_round_answers` RENAME TO `quiz_round_answers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_round_answers_player_day_idempotency_unique` ON `quiz_round_answers` (`day`,`player_id`,`round_no`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `quiz_round_answers_player_day_index` ON `quiz_round_answers` (`player_id`,`day`,`round_no`);--> statement-breakpoint
CREATE TABLE `__new_quiz_round_sessions` (
	`day` text NOT NULL,
	`player_id` text NOT NULL,
	`round_no` integer NOT NULL,
	`started_at` text NOT NULL,
	`current_question_index` integer DEFAULT 0 NOT NULL,
	`current_question_opened_at` text,
	`score` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`day`, `player_id`, `round_no`),
	CONSTRAINT "quiz_round_sessions_round_range" CHECK("__new_quiz_round_sessions"."round_no" BETWEEN 1 AND 2),
	CONSTRAINT "quiz_round_sessions_score_range" CHECK("__new_quiz_round_sessions"."score" BETWEEN 0 AND 3000),
	CONSTRAINT "quiz_round_sessions_correct_range" CHECK("__new_quiz_round_sessions"."correct_count" BETWEEN 0 AND 15)
);
--> statement-breakpoint
INSERT INTO `__new_quiz_round_sessions`("day", "player_id", "round_no", "started_at", "current_question_index", "current_question_opened_at", "score", "correct_count", "completed_at", "created_at", "updated_at") SELECT "day", "player_id", "round_no", "started_at", "current_question_index", "current_question_opened_at", "score", "correct_count", "completed_at", "created_at", "updated_at" FROM `quiz_round_sessions`;--> statement-breakpoint
DROP TABLE `quiz_round_sessions`;--> statement-breakpoint
ALTER TABLE `__new_quiz_round_sessions` RENAME TO `quiz_round_sessions`;--> statement-breakpoint
CREATE INDEX `quiz_round_sessions_daily_leaderboard_index` ON `quiz_round_sessions` (`day`,`round_no`,`completed_at`,`score`,`correct_count`);--> statement-breakpoint
CREATE INDEX `quiz_round_sessions_player_day_index` ON `quiz_round_sessions` (`player_id`,`day`);