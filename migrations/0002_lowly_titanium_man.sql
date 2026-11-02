CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`recovery_code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_recovery_code_hash_unique` ON `players` (`recovery_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `players_display_name_unique` ON `players` (lower("display_name"));--> statement-breakpoint
ALTER TABLE `daily_quizzes` ADD `question_set_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `daily_quizzes_question_set_key_unique` ON `daily_quizzes` (`question_set_key`) WHERE "daily_quizzes"."question_set_key" IS NOT NULL;