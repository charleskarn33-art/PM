-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actor_id` CHAR(36) NULL,
    `actor_name` VARCHAR(120) NULL,
    `actor_email` VARCHAR(255) NULL,
    `action` VARCHAR(60) NOT NULL,
    `outcome` ENUM('SUCCESS', 'DENIED', 'FAILED') NOT NULL DEFAULT 'SUCCESS',
    `entity_type` VARCHAR(40) NULL,
    `entity_id` VARCHAR(64) NULL,
    `summary` VARCHAR(500) NOT NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `changes` JSON NULL,
    `request` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `request_id` VARCHAR(64) NULL,

    INDEX `audit_logs_occurred_at_idx`(`occurred_at`),
    INDEX `audit_logs_entity_type_entity_id_occurred_at_idx`(`entity_type`, `entity_id`, `occurred_at`),
    INDEX `audit_logs_actor_id_occurred_at_idx`(`actor_id`, `occurred_at`),
    INDEX `audit_logs_action_occurred_at_idx`(`action`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The audit log is append-only: nothing (the API included) may change or remove an entry.
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs: the audit log is append-only';
END;

CREATE TRIGGER `audit_logs_no_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs: the audit log is append-only';
END;
