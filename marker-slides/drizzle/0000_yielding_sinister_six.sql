CREATE TABLE `markers` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`slide` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`kind` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`marker` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`image` text,
	`source` text,
	`created` integer NOT NULL,
	FOREIGN KEY (`marker`) REFERENCES `markers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`title` text NOT NULL,
	`slides` text NOT NULL,
	`current` integer DEFAULT 0 NOT NULL,
	`until` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
