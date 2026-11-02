CREATE TABLE `player_recovery_rate_limits` (
	`address_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`hit_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_recovery_rate_limits_window_index` ON `player_recovery_rate_limits` (`window_started_at`);