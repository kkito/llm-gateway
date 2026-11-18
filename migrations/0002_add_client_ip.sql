ALTER TABLE `requests` ADD `client_ip` text;--> statement-breakpoint
CREATE INDEX `idx_client_ip` ON `requests` (`client_ip`);
