-- CreateTable
CREATE TABLE `pm_templates` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `version` SMALLINT UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `description` VARCHAR(1000) NULL,
    `activated_at` DATETIME(3) NULL,
    `retired_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `pm_templates_status_idx`(`status`),
    UNIQUE INDEX `pm_templates_code_version_key`(`code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_sections` (
    `id` CHAR(36) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `category` ENUM('GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER') NOT NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `description` VARCHAR(1000) NULL,
    `allow_not_applicable` BOOLEAN NOT NULL DEFAULT false,
    `requires_equipment` ENUM('GENERATOR', 'SOLAR', 'GRID') NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `pm_sections_template_id_sort_order_idx`(`template_id`, `sort_order`),
    UNIQUE INDEX `pm_sections_template_id_code_key`(`template_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_checklist_items` (
    `id` CHAR(36) NOT NULL,
    `section_id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `prompt` VARCHAR(500) NOT NULL,
    `help_text` VARCHAR(1000) NULL,
    `response_type` ENUM('YES_NO_NA', 'NUMBER', 'TEXT', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME', 'PHOTO') NOT NULL DEFAULT 'YES_NO_NA',
    `options` JSON NULL,
    `allow_not_applicable` BOOLEAN NOT NULL DEFAULT true,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `unit` VARCHAR(20) NULL,
    `min_value` DECIMAL(18, 6) NULL,
    `max_value` DECIMAL(18, 6) NULL,
    `is_integer` BOOLEAN NOT NULL DEFAULT false,
    `failure_on_answer` ENUM('YES', 'NO') NULL,
    `failure_severity` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `requires_photo_on_failure` BOOLEAN NOT NULL DEFAULT false,
    `requires_comment_on_failure` BOOLEAN NOT NULL DEFAULT false,
    `photo_on_answers` JSON NULL,
    `comment_on_answers` JSON NULL,
    `photo_instructions` VARCHAR(500) NULL,
    `analytics_key` VARCHAR(80) NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `pm_checklist_items_section_id_sort_order_idx`(`section_id`, `sort_order`),
    INDEX `pm_checklist_items_analytics_key_idx`(`analytics_key`),
    UNIQUE INDEX `pm_checklist_items_section_id_code_key`(`section_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_reading_fields` (
    `id` CHAR(36) NOT NULL,
    `section_id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `value_type` ENUM('NUMBER', 'TEXT', 'SELECT') NOT NULL DEFAULT 'NUMBER',
    `unit` VARCHAR(20) NULL,
    `is_integer` BOOLEAN NOT NULL DEFAULT false,
    `min_value` DECIMAL(18, 6) NULL,
    `max_value` DECIMAL(18, 6) NULL,
    `options` JSON NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT false,
    `help_text` VARCHAR(1000) NULL,
    `analytics_key` VARCHAR(80) NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `pm_reading_fields_section_id_sort_order_idx`(`section_id`, `sort_order`),
    INDEX `pm_reading_fields_analytics_key_idx`(`analytics_key`),
    UNIQUE INDEX `pm_reading_fields_section_id_code_key`(`section_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_consistency_rules` (
    `id` CHAR(36) NOT NULL,
    `lhs_key` VARCHAR(80) NOT NULL,
    `operator` VARCHAR(2) NOT NULL,
    `rhs_key` VARCHAR(80) NOT NULL,
    `message` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `pm_consistency_rules_lhs_key_operator_rhs_key_key`(`lhs_key`, `operator`, `rhs_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_schedules` (
    `id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `technician_id` CHAR(36) NULL,
    `series_id` CHAR(36) NULL,
    `frequency` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'AD_HOC') NOT NULL DEFAULT 'MONTHLY',
    `scheduled_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'OVERDUE', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `notes` VARCHAR(1000) NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `pm_schedules_site_id_scheduled_date_idx`(`site_id`, `scheduled_date`),
    INDEX `pm_schedules_technician_id_due_date_idx`(`technician_id`, `due_date`),
    INDEX `pm_schedules_status_due_date_idx`(`status`, `due_date`),
    INDEX `pm_schedules_series_id_idx`(`series_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_visits` (
    `id` CHAR(36) NOT NULL,
    `schedule_id` CHAR(36) NULL,
    `site_id` CHAR(36) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `technician_id` CHAR(36) NOT NULL,
    `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'OVERDUE', 'CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
    `started_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `completion_pct` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `failure_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `not_applicable_sections` JSON NOT NULL,
    `overall_comments` VARCHAR(4000) NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_comments` VARCHAR(2000) NULL,
    `client_created_at` DATETIME(3) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `pm_visits_site_id_started_at_idx`(`site_id`, `started_at`),
    INDEX `pm_visits_technician_id_started_at_idx`(`technician_id`, `started_at`),
    INDEX `pm_visits_status_idx`(`status`),
    INDEX `pm_visits_schedule_id_idx`(`schedule_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_responses` (
    `id` CHAR(36) NOT NULL,
    `visit_id` CHAR(36) NOT NULL,
    `checklist_item_id` CHAR(36) NOT NULL,
    `answer` ENUM('YES', 'NO', 'NA') NULL,
    `numeric_value` DECIMAL(18, 6) NULL,
    `text_value` VARCHAR(2000) NULL,
    `selected_options` JSON NULL,
    `date_value` DATE NULL,
    `datetime_value` DATETIME(3) NULL,
    `comment` VARCHAR(2000) NULL,
    `is_failure` BOOLEAN NOT NULL DEFAULT false,
    `prompt_snapshot` VARCHAR(500) NOT NULL,
    `unit_snapshot` VARCHAR(20) NULL,
    `answered_at` DATETIME(3) NOT NULL,
    `answered_by` CHAR(36) NULL,
    `client_updated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pm_responses_checklist_item_id_idx`(`checklist_item_id`),
    INDEX `pm_responses_visit_id_is_failure_idx`(`visit_id`, `is_failure`),
    UNIQUE INDEX `pm_responses_visit_id_checklist_item_id_key`(`visit_id`, `checklist_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_readings` (
    `id` CHAR(36) NOT NULL,
    `visit_id` CHAR(36) NOT NULL,
    `reading_field_id` CHAR(36) NOT NULL,
    `numeric_value` DECIMAL(18, 6) NULL,
    `text_value` VARCHAR(500) NULL,
    `label_snapshot` VARCHAR(200) NOT NULL,
    `unit_snapshot` VARCHAR(20) NULL,
    `captured_at` DATETIME(3) NOT NULL,
    `client_updated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pm_readings_reading_field_id_idx`(`reading_field_id`),
    UNIQUE INDEX `pm_readings_visit_id_reading_field_id_key`(`visit_id`, `reading_field_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_photos` (
    `id` CHAR(36) NOT NULL,
    `visit_id` CHAR(36) NOT NULL,
    `checklist_item_id` CHAR(36) NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `content_type` VARCHAR(40) NOT NULL,
    `size_bytes` INTEGER UNSIGNED NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `caption` VARCHAR(255) NULL,
    `taken_at` DATETIME(3) NULL,
    `uploaded_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pm_photos_storage_key_key`(`storage_key`),
    INDEX `pm_photos_visit_id_checklist_item_id_idx`(`visit_id`, `checklist_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pm_sections` ADD CONSTRAINT `pm_sections_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `pm_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_checklist_items` ADD CONSTRAINT `pm_checklist_items_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `pm_sections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_reading_fields` ADD CONSTRAINT `pm_reading_fields_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `pm_sections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_schedules` ADD CONSTRAINT `pm_schedules_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_schedules` ADD CONSTRAINT `pm_schedules_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `pm_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_schedules` ADD CONSTRAINT `pm_schedules_technician_id_fkey` FOREIGN KEY (`technician_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_visits` ADD CONSTRAINT `pm_visits_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `pm_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_visits` ADD CONSTRAINT `pm_visits_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_visits` ADD CONSTRAINT `pm_visits_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `pm_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_visits` ADD CONSTRAINT `pm_visits_technician_id_fkey` FOREIGN KEY (`technician_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_visits` ADD CONSTRAINT `pm_visits_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_responses` ADD CONSTRAINT `pm_responses_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_responses` ADD CONSTRAINT `pm_responses_checklist_item_id_fkey` FOREIGN KEY (`checklist_item_id`) REFERENCES `pm_checklist_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_readings` ADD CONSTRAINT `pm_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_readings` ADD CONSTRAINT `pm_readings_reading_field_id_fkey` FOREIGN KEY (`reading_field_id`) REFERENCES `pm_reading_fields`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_photos` ADD CONSTRAINT `pm_photos_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_photos` ADD CONSTRAINT `pm_photos_checklist_item_id_fkey` FOREIGN KEY (`checklist_item_id`) REFERENCES `pm_checklist_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_photos` ADD CONSTRAINT `pm_photos_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Manual additions (not expressible in the Prisma schema).
-- -----------------------------------------------------------------------------
ALTER TABLE `pm_templates`
    ADD CONSTRAINT `pm_templates_version_chk` CHECK (`version` > 0);
ALTER TABLE `pm_checklist_items`
    ADD CONSTRAINT `pm_checklist_items_range_chk` CHECK (`min_value` IS NULL OR `max_value` IS NULL OR `min_value` <= `max_value`),
    ADD CONSTRAINT `pm_checklist_items_failure_chk` CHECK (`failure_on_answer` IS NULL OR `response_type` = 'YES_NO_NA');
ALTER TABLE `pm_reading_fields`
    ADD CONSTRAINT `pm_reading_fields_range_chk` CHECK (`min_value` IS NULL OR `max_value` IS NULL OR `min_value` <= `max_value`);
ALTER TABLE `pm_consistency_rules`
    ADD CONSTRAINT `pm_consistency_rules_operator_chk` CHECK (`operator` IN ('<=', '<', '>=', '>', '='));
ALTER TABLE `pm_schedules`
    ADD CONSTRAINT `pm_schedules_dates_chk` CHECK (`due_date` >= `scheduled_date`);
ALTER TABLE `pm_visits`
    ADD CONSTRAINT `pm_visits_completion_chk` CHECK (`completion_pct` BETWEEN 0 AND 100),
    ADD CONSTRAINT `pm_visits_times_chk` CHECK (`completed_at` IS NULL OR `completed_at` >= `started_at`);
ALTER TABLE `pm_photos`
    ADD CONSTRAINT `pm_photos_size_chk` CHECK (`size_bytes` > 0);

-- One ACTIVE version per template code.
CREATE TRIGGER `pm_templates_one_active_insert` BEFORE INSERT ON `pm_templates` FOR EACH ROW
BEGIN
    IF NEW.`status` = 'ACTIVE' AND EXISTS (SELECT 1 FROM `pm_templates` WHERE `code` = NEW.`code` AND `status` = 'ACTIVE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_templates: another version of this template is already active';
    END IF;
END;

CREATE TRIGGER `pm_templates_one_active_update` BEFORE UPDATE ON `pm_templates` FOR EACH ROW
BEGIN
    IF NEW.`status` = 'ACTIVE' AND OLD.`status` <> 'ACTIVE'
       AND EXISTS (SELECT 1 FROM `pm_templates` WHERE `code` = NEW.`code` AND `status` = 'ACTIVE' AND `id` <> NEW.`id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_templates: another version of this template is already active';
    END IF;
    IF OLD.`status` = 'RETIRED' AND NEW.`status` <> 'RETIRED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_templates: a retired version cannot be reactivated; create a new version';
    END IF;
END;

-- A template version's structure can change only while it is a DRAFT (visits pin versions).
CREATE TRIGGER `pm_sections_draft_insert` BEFORE INSERT ON `pm_sections` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `pm_templates` WHERE `id` = NEW.`template_id`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_sections: only a draft template version can be changed';
    END IF;
END;
CREATE TRIGGER `pm_sections_draft_update` BEFORE UPDATE ON `pm_sections` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `pm_templates` WHERE `id` = OLD.`template_id`) <> 'DRAFT'
       OR NEW.`template_id` <> OLD.`template_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_sections: only a draft template version can be changed';
    END IF;
END;
CREATE TRIGGER `pm_sections_draft_delete` BEFORE DELETE ON `pm_sections` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `pm_templates` WHERE `id` = OLD.`template_id`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_sections: only a draft template version can be changed';
    END IF;
END;

CREATE TRIGGER `pm_checklist_items_draft_insert` BEFORE INSERT ON `pm_checklist_items` FOR EACH ROW
BEGIN
    IF (SELECT t.`status` FROM `pm_sections` s JOIN `pm_templates` t ON t.`id` = s.`template_id` WHERE s.`id` = NEW.`section_id`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_checklist_items: only a draft template version can be changed';
    END IF;
END;
CREATE TRIGGER `pm_checklist_items_draft_update` BEFORE UPDATE ON `pm_checklist_items` FOR EACH ROW
BEGIN
    IF (SELECT t.`status` FROM `pm_sections` s JOIN `pm_templates` t ON t.`id` = s.`template_id` WHERE s.`id` = OLD.`section_id`) <> 'DRAFT'
       OR NEW.`section_id` <> OLD.`section_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_checklist_items: only a draft template version can be changed';
    END IF;
END;
CREATE TRIGGER `pm_checklist_items_draft_delete` BEFORE DELETE ON `pm_checklist_items` FOR EACH ROW
BEGIN
    IF (SELECT t.`status` FROM `pm_sections` s JOIN `pm_templates` t ON t.`id` = s.`template_id` WHERE s.`id` = OLD.`section_id`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_checklist_items: only a draft template version can be changed';
    END IF;
END;

CREATE TRIGGER `pm_reading_fields_draft_insert` BEFORE INSERT ON `pm_reading_fields` FOR EACH ROW
BEGIN
    IF (SELECT t.`status` FROM `pm_sections` s JOIN `pm_templates` t ON t.`id` = s.`template_id` WHERE s.`id` = NEW.`section_id`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_reading_fields: only a draft template version can be changed';
    END IF;
END;
CREATE TRIGGER `pm_reading_fields_draft_update` BEFORE UPDATE ON `pm_reading_fields` FOR EACH ROW
BEGIN
    IF (SELECT t.`status` FROM `pm_sections` s JOIN `pm_templates` t ON t.`id` = s.`template_id` WHERE s.`id` = OLD.`section_id`) <> 'DRAFT'
       OR NEW.`section_id` <> OLD.`section_id` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_reading_fields: only a draft template version can be changed';
    END IF;
END;
CREATE TRIGGER `pm_reading_fields_draft_delete` BEFORE DELETE ON `pm_reading_fields` FOR EACH ROW
BEGIN
    IF (SELECT t.`status` FROM `pm_sections` s JOIN `pm_templates` t ON t.`id` = s.`template_id` WHERE s.`id` = OLD.`section_id`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pm_reading_fields: only a draft template version can be changed';
    END IF;
END;
