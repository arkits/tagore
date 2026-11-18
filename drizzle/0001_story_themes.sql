ALTER TABLE `projects` ADD `theme` text DEFAULT 'folio' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `pov` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `format` = 'prose' WHERE `format` NOT IN ('prose', 'chat');
