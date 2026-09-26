-- AlterTable
ALTER TABLE `pm_visits` ADD COLUMN `geofence_mode` ENUM('WARN', 'REQUIRE_REASON', 'BLOCK') NULL,
    ADD COLUMN `gps_accuracy_m` DECIMAL(10, 2) NULL,
    ADD COLUMN `gps_captured_at` DATETIME(3) NULL,
    ADD COLUMN `gps_distance_m` DECIMAL(12, 2) NULL,
    ADD COLUMN `gps_latitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `gps_longitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `gps_radius_m` INTEGER UNSIGNED NULL,
    ADD COLUMN `gps_status` ENUM('WITHIN_RADIUS', 'OUTSIDE_RADIUS', 'UNAVAILABLE', 'SITE_HAS_NO_COORDINATES') NULL,
    ADD COLUMN `outside_radius_reason` VARCHAR(500) NULL,
    ADD COLUMN `signature_key` VARCHAR(255) NULL,
    ADD COLUMN `signed_at` DATETIME(3) NULL,
    ADD COLUMN `signed_name` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `sites` ADD COLUMN `geofence_radius_m` INTEGER UNSIGNED NULL;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Manual additions (not expressible in the Prisma schema).
ALTER TABLE `sites`
    ADD CONSTRAINT `sites_geofence_radius_chk` CHECK (`geofence_radius_m` IS NULL OR `geofence_radius_m` > 0);
ALTER TABLE `pm_visits`
    ADD CONSTRAINT `pm_visits_gps_pair_chk` CHECK ((`gps_latitude` IS NULL) = (`gps_longitude` IS NULL)),
    ADD CONSTRAINT `pm_visits_gps_range_chk` CHECK (`gps_latitude` IS NULL OR (`gps_latitude` BETWEEN -90 AND 90 AND `gps_longitude` BETWEEN -180 AND 180)),
    ADD CONSTRAINT `pm_visits_signature_chk` CHECK ((`signature_key` IS NULL) = (`signed_at` IS NULL));
