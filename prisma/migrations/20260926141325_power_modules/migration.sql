-- AlterTable
ALTER TABLE `sites` ADD COLUMN `battery_unit_count` SMALLINT UNSIGNED NULL;

-- CreateTable
CREATE TABLE `generator_readings` (
    `visit_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `running_hours` DECIMAL(18, 6) NULL,
    `oil_pressure` VARCHAR(500) NULL,
    `oil_pressure_bar` DECIMAL(18, 6) NULL,
    `fuel_level_pct` DECIMAL(18, 6) NULL,
    `generator_kva` DECIMAL(18, 6) NULL,
    `engine_oil_changed` BOOLEAN NULL,
    `fuel_filter_changed` BOOLEAN NULL,
    `oil_filter_changed` BOOLEAN NULL,
    `requires_service` BOOLEAN NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `generator_readings_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dc_readings` (
    `visit_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `rectifier_voltage_v` DECIMAL(18, 6) NULL,
    `load_current_a` DECIMAL(18, 6) NULL,
    `rectifier_module_count` INTEGER NULL,
    `dc_modules_installed` INTEGER NULL,
    `dc_modules_operational` INTEGER NULL,
    `controller_model` VARCHAR(500) NULL,
    `dc_power_kw` DECIMAL(18, 6) NULL,
    `total_phase_current_a` DECIMAL(18, 6) NULL,
    `phases_recorded` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dc_readings_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dc_phase_currents` (
    `visit_id` CHAR(36) NOT NULL,
    `phase_number` TINYINT UNSIGNED NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `amp_value` DECIMAL(18, 6) NOT NULL,
    `comment` VARCHAR(2000) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dc_phase_currents_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`, `phase_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `battery_readings` (
    `visit_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `battery_voltage_v` DECIMAL(18, 6) NULL,
    `capacity_ah` DECIMAL(18, 6) NULL,
    `string_count` INTEGER NULL,
    `physical_damage_found` BOOLEAN NULL,
    `water_top_up_required` BOOLEAN NULL,
    `units_recorded` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `min_unit_voltage_v` DECIMAL(18, 6) NULL,
    `max_unit_voltage_v` DECIMAL(18, 6) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `battery_readings_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `battery_unit_readings` (
    `visit_id` CHAR(36) NOT NULL,
    `unit_number` SMALLINT UNSIGNED NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `voltage_v` DECIMAL(18, 6) NOT NULL,
    `comment` VARCHAR(500) NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `client_updated_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `battery_unit_readings_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`, `unit_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `solar_readings` (
    `visit_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `panels_installed` INTEGER NULL,
    `panels_operational` INTEGER NULL,
    `damaged_panel_count` INTEGER NULL,
    `charge_controller_output_v` DECIMAL(18, 6) NULL,
    `panels_cleaned` BOOLEAN NULL,
    `system_operating_normally` BOOLEAN NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `solar_readings_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `non_technical_observations` (
    `visit_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `power_equipment_cleaned` BOOLEAN NULL,
    `dust_removed` BOOLEAN NULL,
    `shelter_cleaned` BOOLEAN NULL,
    `vegetation_clear` BOOLEAN NULL,
    `free_of_debris` BOOLEAN NULL,
    `cable_trays_organised` BOOLEAN NULL,
    `fence_gate_good` BOOLEAN NULL,
    `equipment_missing` BOOLEAN NULL,
    `security_lights_working` BOOLEAN NULL,
    `aviation_lights_working` BOOLEAN NULL,
    `locks_secure` BOOLEAN NULL,
    `oil_fuel_spill` BOOLEAN NULL,
    `fire_extinguisher_present` BOOLEAN NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `non_technical_observations_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earthing_readings` (
    `visit_id` CHAR(36) NOT NULL,
    `site_id` CHAR(36) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `inspected` BOOLEAN NULL,
    `earth_cable_connected` BOOLEAN NULL,
    `free_from_corrosion` BOOLEAN NULL,
    `pit_condition_acceptable` BOOLEAN NULL,
    `abnormalities_found` BOOLEAN NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `earthing_readings_site_id_recorded_at_idx`(`site_id`, `recorded_at`),
    PRIMARY KEY (`visit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `generator_readings` ADD CONSTRAINT `generator_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generator_readings` ADD CONSTRAINT `generator_readings_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dc_readings` ADD CONSTRAINT `dc_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dc_readings` ADD CONSTRAINT `dc_readings_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dc_phase_currents` ADD CONSTRAINT `dc_phase_currents_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dc_phase_currents` ADD CONSTRAINT `dc_phase_currents_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `battery_readings` ADD CONSTRAINT `battery_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `battery_readings` ADD CONSTRAINT `battery_readings_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `battery_unit_readings` ADD CONSTRAINT `battery_unit_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `battery_unit_readings` ADD CONSTRAINT `battery_unit_readings_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solar_readings` ADD CONSTRAINT `solar_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solar_readings` ADD CONSTRAINT `solar_readings_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `non_technical_observations` ADD CONSTRAINT `non_technical_observations_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `non_technical_observations` ADD CONSTRAINT `non_technical_observations_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earthing_readings` ADD CONSTRAINT `earthing_readings_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `pm_visits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earthing_readings` ADD CONSTRAINT `earthing_readings_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual additions (not expressible in the Prisma schema).
ALTER TABLE `sites`
    ADD CONSTRAINT `sites_battery_unit_count_chk` CHECK (`battery_unit_count` IS NULL OR `battery_unit_count` BETWEEN 1 AND 1000);
ALTER TABLE `dc_phase_currents`
    ADD CONSTRAINT `dc_phase_currents_phase_chk` CHECK (`phase_number` >= 1);
ALTER TABLE `battery_unit_readings`
    ADD CONSTRAINT `battery_unit_readings_unit_chk` CHECK (`unit_number` >= 1);
