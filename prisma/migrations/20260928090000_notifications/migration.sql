-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `entity_type` VARCHAR(20) NULL,
    `entity_id` CHAR(36) NULL,
    `dedup_key` VARCHAR(120) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `push_status` ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'NO_DEVICE', 'SKIPPED') NULL,
    `push_claim` CHAR(36) NULL,
    `push_claimed_at` DATETIME(3) NULL,
    `push_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `pushed_at` DATETIME(3) NULL,
    `push_error` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_created_at_idx`(`user_id`, `read_at`, `created_at`),
    INDEX `notifications_push_status_created_at_idx`(`push_status`, `created_at`),
    INDEX `notifications_push_claim_idx`(`push_claim`),
    UNIQUE INDEX `notifications_user_id_dedup_key_key`(`user_id`, `dedup_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `platform` VARCHAR(20) NOT NULL,
    `device_name` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `push_tokens_token_key`(`token`),
    INDEX `push_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_tokens` ADD CONSTRAINT `push_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

