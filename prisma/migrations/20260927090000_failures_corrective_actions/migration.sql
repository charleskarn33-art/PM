-- CreateTable
CREATE TABLE `failures` (
    `id` CHAR(36) NOT NULL,
    `number` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `source` ENUM('PM_CHECKLIST', 'MANUAL') NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `visit_id` CHAR(36) NULL,
    `checklist_item_id` CHAR(36) NULL,
    `section_code` VARCHAR(40) NULL,
    `category` ENUM('GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER') NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `description` VARCHAR(4000) NULL,
    `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `still_reported` BOOLEAN NOT NULL DEFAULT true,
    `reported_by` CHAR(36) NULL,
    `detected_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,
    `verified_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `closed_by` CHAR(36) NULL,
    `close_note` VARCHAR(2000) NULL,
    `reopened_at` DATETIME(3) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `failures_number_key`(`number`),
    INDEX `failures_site_id_status_idx`(`site_id`, `status`),
    INDEX `failures_status_severity_idx`(`status`, `severity`),
    INDEX `failures_detected_at_idx`(`detected_at`),
    INDEX `failures_checklist_item_id_idx`(`checklist_item_id`),
    UNIQUE INDEX `failures_visit_id_checklist_item_id_key`(`visit_id`, `checklist_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corrective_actions` (
    `id` CHAR(36) NOT NULL,
    `number` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `failure_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` VARCHAR(4000) NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `assigned_to` CHAR(36) NULL,
    `assigned_by` CHAR(36) NULL,
    `assigned_at` DATETIME(3) NULL,
    `due_date` DATE NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `completed_by` CHAR(36) NULL,
    `completion_note` VARCHAR(2000) NULL,
    `verified_at` DATETIME(3) NULL,
    `verified_by` CHAR(36) NULL,
    `verification_note` VARCHAR(2000) NULL,
    `closed_at` DATETIME(3) NULL,
    `closed_by` CHAR(36) NULL,
    `close_note` VARCHAR(2000) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `corrective_actions_number_key`(`number`),
    INDEX `corrective_actions_failure_id_idx`(`failure_id`),
    INDEX `corrective_actions_assigned_to_status_idx`(`assigned_to`, `status`),
    INDEX `corrective_actions_site_id_status_idx`(`site_id`, `status`),
    INDEX `corrective_actions_status_due_date_idx`(`status`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `failure_updates` (
    `id` CHAR(36) NOT NULL,
    `failure_id` CHAR(36) NOT NULL,
    `corrective_action_id` CHAR(36) NULL,
    `author_id` CHAR(36) NULL,
    `kind` ENUM('COMMENT', 'STATUS', 'SYSTEM') NOT NULL,
    `body` VARCHAR(4000) NULL,
    `from_status` VARCHAR(20) NULL,
    `to_status` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `failure_updates_failure_id_created_at_idx`(`failure_id`, `created_at`),
    INDEX `failure_updates_corrective_action_id_created_at_idx`(`corrective_action_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `failure_attachments` (
    `id` CHAR(36) NOT NULL,
    `failure_id` CHAR(36) NOT NULL,
    `corrective_action_id` CHAR(36) NULL,
    `kind` ENUM('PHOTO', 'DOCUMENT') NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `content_type` VARCHAR(80) NOT NULL,
    `size_bytes` INTEGER UNSIGNED NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `caption` VARCHAR(255) NULL,
    `uploaded_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `failure_attachments_storage_key_key`(`storage_key`),
    INDEX `failure_attachments_failure_id_created_at_idx`(`failure_id`, `created_at`),
    INDEX `failure_attachments_corrective_action_id_idx`(`corrective_action_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `failures` ADD CONSTRAINT `failures_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failures` ADD CONSTRAINT `failures_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failures` ADD CONSTRAINT `failures_checklist_item_id_fkey` FOREIGN KEY (`checklist_item_id`) REFERENCES `pm_checklist_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failures` ADD CONSTRAINT `failures_reported_by_fkey` FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failures` ADD CONSTRAINT `failures_closed_by_fkey` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_failure_id_fkey` FOREIGN KEY (`failure_id`) REFERENCES `failures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_completed_by_fkey` FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_verified_by_fkey` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_closed_by_fkey` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failure_updates` ADD CONSTRAINT `failure_updates_failure_id_fkey` FOREIGN KEY (`failure_id`) REFERENCES `failures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failure_updates` ADD CONSTRAINT `failure_updates_corrective_action_id_fkey` FOREIGN KEY (`corrective_action_id`) REFERENCES `corrective_actions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failure_updates` ADD CONSTRAINT `failure_updates_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failure_attachments` ADD CONSTRAINT `failure_attachments_failure_id_fkey` FOREIGN KEY (`failure_id`) REFERENCES `failures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failure_attachments` ADD CONSTRAINT `failure_attachments_corrective_action_id_fkey` FOREIGN KEY (`corrective_action_id`) REFERENCES `corrective_actions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `failure_attachments` ADD CONSTRAINT `failure_attachments_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Manual additions (not expressible in the Prisma schema). Rules on columns
-- that are foreign keys (MySQL does not allow CHECKs on them) are enforced by
-- the API.
ALTER TABLE `failures`
    ADD CONSTRAINT `failures_title_chk` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0);
ALTER TABLE `corrective_actions`
    ADD CONSTRAINT `corrective_actions_title_chk` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
    ADD CONSTRAINT `corrective_actions_completion_note_chk` CHECK (`status` NOT IN ('COMPLETED', 'VERIFIED') OR `completion_note` IS NOT NULL);
ALTER TABLE `failure_updates`
    ADD CONSTRAINT `failure_updates_comment_chk` CHECK (`kind` <> 'COMMENT' OR CHAR_LENGTH(TRIM(`body`)) > 0);
