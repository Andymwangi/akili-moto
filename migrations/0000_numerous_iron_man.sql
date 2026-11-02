CREATE TABLE `allowed_guesses` (
	`word` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `answer_pool` (
	`word` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_answers` (
	`day` text PRIMARY KEY NOT NULL,
	`word` text NOT NULL,
	FOREIGN KEY (`word`) REFERENCES `answer_pool`(`word`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_answers_word_unique` ON `daily_answers` (`word`);--> statement-breakpoint
CREATE TABLE `guesses` (
	`day` text NOT NULL,
	`player_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`guess` text NOT NULL,
	`feedback` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`day`, `player_id`, `attempt_no`),
	CONSTRAINT "guesses_attempt_no_range" CHECK("guesses"."attempt_no" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guesses_player_day_idempotency_unique` ON `guesses` (`day`,`player_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `guesses_player_day_index` ON `guesses` (`player_id`,`day`);