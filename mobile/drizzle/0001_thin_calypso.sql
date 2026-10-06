CREATE TABLE `crawl_queue` (
	`url` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `crawl_queue_due` ON `crawl_queue` (`host`,`next_at`);--> statement-breakpoint
CREATE TABLE `crawl_state` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`busy_until` integer DEFAULT 0 NOT NULL
);
