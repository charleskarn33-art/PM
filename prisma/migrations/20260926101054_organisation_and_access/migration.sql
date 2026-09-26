-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `employee_code` VARCHAR(32) NULL,
    `password_hash` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `home_region_id` CHAR(36) NULL,
    `reports_to_id` CHAR(36) NULL,
    `last_login_at` DATETIME(3) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_employee_code_key`(`employee_code`),
    INDEX `users_home_region_id_idx`(`home_region_id`),
    INDEX `users_reports_to_id_idx`(`reports_to_id`),
    INDEX `users_is_active_idx`(`is_active`),
    INDEX `users_full_name_idx`(`full_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `granted_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_region_scopes` (
    `user_id` CHAR(36) NOT NULL,
    `region_id` CHAR(36) NOT NULL,
    `granted_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_region_scopes_region_id_idx`(`region_id`),
    PRIMARY KEY (`user_id`, `region_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `regions` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `regions_code_key`(`code`),
    UNIQUE INDEX `regions_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clusters` (
    `id` CHAR(36) NOT NULL,
    `region_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `clusters_code_key`(`code`),
    UNIQUE INDEX `clusters_region_id_name_key`(`region_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counties` (
    `id` CHAR(36) NOT NULL,
    `cluster_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `counties_code_key`(`code`),
    UNIQUE INDEX `counties_cluster_id_name_key`(`cluster_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sites` (
    `id` CHAR(36) NOT NULL,
    `site_code` VARCHAR(32) NOT NULL,
    `site_name` VARCHAR(120) NOT NULL,
    `region_id` CHAR(36) NOT NULL,
    `cluster_id` CHAR(36) NULL,
    `county_id` CHAR(36) NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `address` VARCHAR(500) NULL,
    `site_type` VARCHAR(50) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'DECOMMISSIONED') NOT NULL DEFAULT 'ACTIVE',
    `generator_available` BOOLEAN NOT NULL DEFAULT false,
    `solar_available` BOOLEAN NOT NULL DEFAULT false,
    `grid_available` BOOLEAN NOT NULL DEFAULT false,
    `battery_configuration` VARCHAR(500) NULL,
    `power_configuration` VARCHAR(500) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `sites_site_code_key`(`site_code`),
    INDEX `sites_site_name_idx`(`site_name`),
    INDEX `sites_region_id_idx`(`region_id`),
    INDEX `sites_cluster_id_idx`(`cluster_id`),
    INDEX `sites_county_id_idx`(`county_id`),
    INDEX `sites_status_idx`(`status`),
    INDEX `sites_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_assignments` (
    `id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('TECHNICIAN', 'SUPERVISOR') NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `end_reason` VARCHAR(255) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `assigned_by` CHAR(36) NULL,
    `ended_by` CHAR(36) NULL,

    INDEX `site_assignments_site_id_role_active_idx`(`site_id`, `role`, `active`),
    INDEX `site_assignments_user_id_active_idx`(`user_id`, `active`),
    INDEX `site_assignments_start_date_idx`(`start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_home_region_id_fkey` FOREIGN KEY (`home_region_id`) REFERENCES `regions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_reports_to_id_fkey` FOREIGN KEY (`reports_to_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_region_scopes` ADD CONSTRAINT `user_region_scopes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_region_scopes` ADD CONSTRAINT `user_region_scopes_region_id_fkey` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_region_scopes` ADD CONSTRAINT `user_region_scopes_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `regions` ADD CONSTRAINT `regions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `regions` ADD CONSTRAINT `regions_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clusters` ADD CONSTRAINT `clusters_region_id_fkey` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clusters` ADD CONSTRAINT `clusters_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clusters` ADD CONSTRAINT `clusters_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counties` ADD CONSTRAINT `counties_cluster_id_fkey` FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counties` ADD CONSTRAINT `counties_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counties` ADD CONSTRAINT `counties_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_region_id_fkey` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_cluster_id_fkey` FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_county_id_fkey` FOREIGN KEY (`county_id`) REFERENCES `counties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_ended_by_fkey` FOREIGN KEY (`ended_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Rules Prisma cannot express: value ranges (CHECK) and organisational
-- consistency (triggers). The API enforces the same rules with clear messages;
-- these guard the data against any other writer.
-- =============================================================================

ALTER TABLE `users`
    ADD CONSTRAINT `users_email_lowercase_chk` CHECK (CAST(`email` AS BINARY) = CAST(LOWER(`email`) AS BINARY));

ALTER TABLE `sites`
    ADD CONSTRAINT `sites_latitude_chk` CHECK (`latitude` IS NULL OR `latitude` BETWEEN -90 AND 90),
    ADD CONSTRAINT `sites_longitude_chk` CHECK (`longitude` IS NULL OR `longitude` BETWEEN -180 AND 180),
    ADD CONSTRAINT `sites_coordinates_pair_chk` CHECK ((`latitude` IS NULL) = (`longitude` IS NULL));

ALTER TABLE `site_assignments`
    ADD CONSTRAINT `site_assignments_dates_chk` CHECK (`end_date` IS NULL OR `end_date` >= `start_date`),
    ADD CONSTRAINT `site_assignments_ended_chk` CHECK (`active` OR `end_date` IS NOT NULL);

-- A site's county must belong to its cluster, and its cluster to its region.
CREATE TRIGGER `sites_hierarchy_insert` BEFORE INSERT ON `sites` FOR EACH ROW
BEGIN
    IF NEW.`county_id` IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM `counties` c WHERE c.`id` = NEW.`county_id` AND c.`cluster_id` <=> NEW.`cluster_id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sites: the county does not belong to the site''s cluster';
    END IF;
    IF NEW.`cluster_id` IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM `clusters` k WHERE k.`id` = NEW.`cluster_id` AND k.`region_id` = NEW.`region_id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sites: the cluster does not belong to the site''s region';
    END IF;
END;

CREATE TRIGGER `sites_hierarchy_update` BEFORE UPDATE ON `sites` FOR EACH ROW
BEGIN
    IF NEW.`county_id` IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM `counties` c WHERE c.`id` = NEW.`county_id` AND c.`cluster_id` <=> NEW.`cluster_id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sites: the county does not belong to the site''s cluster';
    END IF;
    IF NEW.`cluster_id` IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM `clusters` k WHERE k.`id` = NEW.`cluster_id` AND k.`region_id` = NEW.`region_id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sites: the cluster does not belong to the site''s region';
    END IF;
END;

-- Moving a cluster or county that sites use would silently break their hierarchy.
CREATE TRIGGER `clusters_region_move` BEFORE UPDATE ON `clusters` FOR EACH ROW
BEGIN
    IF NEW.`region_id` <> OLD.`region_id` AND EXISTS (SELECT 1 FROM `sites` s WHERE s.`cluster_id` = OLD.`id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'clusters: sites use this cluster; move or reassign them first';
    END IF;
END;

CREATE TRIGGER `counties_cluster_move` BEFORE UPDATE ON `counties` FOR EACH ROW
BEGIN
    IF NEW.`cluster_id` <> OLD.`cluster_id` AND EXISTS (SELECT 1 FROM `sites` s WHERE s.`county_id` = OLD.`id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'counties: sites use this county; move or reassign them first';
    END IF;
END;
