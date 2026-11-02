CREATE TABLE `daily_quizzes` (
	`day` text PRIMARY KEY NOT NULL,
	`question_ids` text NOT NULL,
	`question_set_version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quiz_answers` (
	`day` text NOT NULL,
	`player_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`question_id` text NOT NULL,
	`selected_option_id` text NOT NULL,
	`correct_option_id` text NOT NULL,
	`is_correct` integer NOT NULL,
	`points` integer NOT NULL,
	`response_ms` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`day`, `player_id`, `question_index`),
	CONSTRAINT "quiz_answers_question_index_range" CHECK("quiz_answers"."question_index" BETWEEN 0 AND 9),
	CONSTRAINT "quiz_answers_option_id_range" CHECK("quiz_answers"."selected_option_id" IN ('a', 'b', 'c', 'd')),
	CONSTRAINT "quiz_answers_correct_option_id_range" CHECK("quiz_answers"."correct_option_id" IN ('a', 'b', 'c', 'd')),
	CONSTRAINT "quiz_answers_points_range" CHECK("quiz_answers"."points" BETWEEN 0 AND 120),
	CONSTRAINT "quiz_answers_response_ms_range" CHECK("quiz_answers"."response_ms" BETWEEN 0 AND 86400000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_answers_player_day_idempotency_unique` ON `quiz_answers` (`day`,`player_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `quiz_answers_player_day_index` ON `quiz_answers` (`player_id`,`day`);--> statement-breakpoint
CREATE TABLE `quiz_sessions` (
	`day` text NOT NULL,
	`player_id` text NOT NULL,
	`started_at` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`day`, `player_id`),
	CONSTRAINT "quiz_sessions_score_range" CHECK("quiz_sessions"."score" BETWEEN 0 AND 1200),
	CONSTRAINT "quiz_sessions_correct_range" CHECK("quiz_sessions"."correct_count" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE INDEX `quiz_sessions_daily_leaderboard_index` ON `quiz_sessions` (`day`,`completed_at`,`score`,`correct_count`);