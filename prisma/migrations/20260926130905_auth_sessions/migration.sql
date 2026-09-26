-- AlterTable
ALTER TABLE `users` ADD COLUMN `failed_login_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN `locked_until` DATETIME(3) NULL,
    ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `password_changed_at` DATETIME(3) NULL,
    ADD COLUMN `sessions_valid_after` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `client` VARCHAR(16) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` VARCHAR(32) NULL,
    `replaced_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refresh_tokens_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    INDEX `refresh_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual additions (not expressible in the Prisma schema).
ALTER TABLE `refresh_tokens`
    ADD CONSTRAINT `refresh_tokens_client_chk` CHECK (`client` IN ('web', 'mobile')),
    ADD CONSTRAINT `refresh_tokens_revoked_chk` CHECK ((`revoked_at` IS NULL) = (`revoked_reason` IS NULL));
