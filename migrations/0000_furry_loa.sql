CREATE TABLE `requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`created_at` integer NOT NULL,
	`user_name` text,
	`custom_model` text,
	`real_model` text,
	`provider` text,
	`model_group` text,
	`actual_model` text,
	`endpoint` text,
	`status_code` integer,
	`duration_ms` integer,
	`is_streaming` integer,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`cached_tokens` integer,
	`error_message` text,
	`error_type` text,
	`response_metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_request_id_unique` ON `requests` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_timestamp` ON `requests` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_user_name` ON `requests` (`user_name`);--> statement-breakpoint
CREATE INDEX `idx_custom_model` ON `requests` (`custom_model`);--> statement-breakpoint
CREATE INDEX `idx_created_at` ON `requests` (`created_at`);