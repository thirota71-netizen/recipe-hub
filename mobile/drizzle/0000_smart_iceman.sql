CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_url_unique` ON `recipes` (`url`);