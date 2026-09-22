-- =============================================================================
-- Reference PM template, version 1.
--
-- Structure and terminology follow the Tienii (1301) Preventative Maintenance
-- Report (2026-09-15): six sections, their readings and checklist questions.
--
-- Failure rules are seeded from each question's polarity (e.g. "Is the machine
-- burning oil?" YES -> failure; "Is Automation Working?" NO -> failure).
-- Task-style items ("Fuel Filter Change") and inspection/cleaning confirmations
-- do not create failures. Every seeded failure uses MEDIUM severity; admins
-- set the real severities in PM Template Management. Nothing here imposes
-- engineering limits: only definitional bounds (percent 0-100, counts >= 0).
-- =============================================================================

insert into public.pm_templates (code, name, version, status, description)
values ('TELECOM_SITE_POWER_PM', 'Telecom Site Power Preventive Maintenance', 1, 'ACTIVE',
        'Reference checklist derived from the Tienii (1301) PM report.');

insert into public.pm_sections
  (template_id, code, name, category, sort_order, allow_not_applicable, applicable_site_flag)
select t.id, s.code, s.name, s.category::public.pm_category, s.sort_order, s.allow_na, s.flag
  from public.pm_templates t
 cross join (values
   ('GENERATOR',     'Generator',                  'GENERATOR',     1, true,  'generator_available'),
   ('DC_SYSTEM',     'DC System',                  'DC_SYSTEM',     2, false, null),
   ('BATTERY',       'Battery',                    'BATTERY',       3, true,  'battery_available'),
   ('SOLAR',         'Solar',                      'SOLAR',         4, true,  'solar_available'),
   ('NON_TECHNICAL', 'Non-Technical Observations', 'NON_TECHNICAL', 5, false, null),
   ('EARTHING',      'Earthing / Grounding',       'EARTHING',      6, false, null)
 ) as s(code, name, category, sort_order, allow_na, flag)
 where t.code = 'TELECOM_SITE_POWER_PM' and t.version = 1;

-- -----------------------------------------------------------------------------
-- Reading fields
-- -----------------------------------------------------------------------------
insert into public.pm_reading_fields
  (section_id, code, label, value_type, unit, is_integer, min_value, max_value, is_required, analytics_key, sort_order)
select s.id, r.code, r.label, r.value_type::public.response_type, r.unit, r.is_integer, r.min_value, r.max_value,
       r.is_required, r.analytics_key, r.sort_order
  from public.pm_sections s
  join public.pm_templates t on t.id = s.template_id and t.code = 'TELECOM_SITE_POWER_PM' and t.version = 1
  join (values
    ('GENERATOR', 'running_hours',    'Running Hours',       'NUMBER', 'h',   false, 0::numeric, null::numeric, true,  'generator.running_hours',   1),
    ('GENERATOR', 'oil_pressure',     'Oil Pressure (BAR)',  'NUMBER', 'bar', false, 0,    null, true,  'generator.oil_pressure_bar',  2),
    ('GENERATOR', 'fuel_level',       'Fuel Level (%)',      'NUMBER', '%',   false, 0,    100,  true,  'generator.fuel_level_pct',    3),
    ('GENERATOR', 'generator_kva',    'Generator KVA',       'NUMBER', 'kVA', false, 0,    null, true,  'generator.generator_kva',     4),

    ('DC_SYSTEM', 'rectifier_output_voltage', 'Rectifier Output Voltage (V)', 'NUMBER', 'V', false, 0, null, true, 'dc.rectifier_voltage_v',   1),
    ('DC_SYSTEM', 'load_current',             'Load Current (A)',             'NUMBER', 'A', false, 0, null, true, 'dc.load_current_a',        2),
    ('DC_SYSTEM', 'rectifier_module_count',   'Number of Rectifier Modules',  'NUMBER', null, true, 0, null, true, 'dc.rectifier_module_count', 3),
    ('DC_SYSTEM', 'dc_modules_installed',     'DC Modules Installed',         'NUMBER', null, true, 0, null, true, 'dc.dc_modules_installed',  4),
    ('DC_SYSTEM', 'dc_modules_operational',   'DC Modules Operational',       'NUMBER', null, true, 0, null, true, 'dc.dc_modules_operational', 5),
    ('DC_SYSTEM', 'controller_model',         'NCU / CSB / TRION Model',      'TEXT',   null, false, null, null, true, 'dc.controller_model',    6),

    ('BATTERY', 'battery_voltage',  'Battery Voltage (V)',       'NUMBER', 'V',  false, 0, null, true, 'battery.battery_voltage_v', 1),
    ('BATTERY', 'battery_capacity', 'Battery Capacity (Ah)',     'NUMBER', 'Ah', false, 0, null, true, 'battery.capacity_ah',       2),
    ('BATTERY', 'battery_strings',  'Number of Battery Strings', 'NUMBER', null, true,  0, null, true, 'battery.string_count',      3),

    ('SOLAR', 'panels_installed',           'Panels Installed',             'NUMBER', null, true,  0, null, true, 'solar.panels_installed',           1),
    ('SOLAR', 'panels_operational',         'Panels Operational',           'NUMBER', null, true,  0, null, true, 'solar.panels_operational',         2),
    ('SOLAR', 'charge_controller_output',   'Charge Controller Output (V)', 'NUMBER', 'V',  false, 0, null, true, 'solar.charge_controller_output_v', 3)
  ) as r(section_code, code, label, value_type, unit, is_integer, min_value, max_value, is_required, analytics_key, sort_order)
    on r.section_code = s.code;

-- -----------------------------------------------------------------------------
-- Checklist items
--   fail: 'NO' | 'YES' | null   (answer that creates a failure)
--   photo_on / comment_on: answers requiring evidence regardless of failure
-- -----------------------------------------------------------------------------
insert into public.pm_checklist_items
  (section_id, code, prompt, response_type, unit, min_value, is_required, allow_not_applicable,
   creates_failure_on_no, creates_failure_on_yes, requires_photo_on_failure, requires_comment_on_failure,
   requires_photo_on_answer, requires_comment_on_answer, photo_instructions, help_text, metadata,
   analytics_key, sort_order)
select s.id, i.code, i.prompt, i.response_type::public.response_type, i.unit, i.min_value, i.is_required, true,
       coalesce(i.fail = 'NO', false), coalesce(i.fail = 'YES', false),
       i.fail is not null, i.fail is not null,
       i.photo_on::public.yes_no_na[], i.comment_on::public.yes_no_na[], i.photo_instructions, i.help_text,
       i.metadata::jsonb, i.analytics_key, i.sort_order
  from public.pm_sections s
  join public.pm_templates t on t.id = s.template_id and t.code = 'TELECOM_SITE_POWER_PM' and t.version = 1
  join (values
    -- GENERATOR --------------------------------------------------------------
    ('GENERATOR', 'gen_physically_inspected', 'Is the generator physically inspected?', 'YES_NO_NA', null, null::numeric, true, null, '{}', '{NO}', null, null, '{}', null, 1),
    ('GENERATOR', 'gen_requires_service', 'Does the generator require servicing or corrective maintenance?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', 'generator.requires_service', 2),
    ('GENERATOR', 'gen_automation_working', 'Is Automation Working?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 3),
    ('GENERATOR', 'gen_engine_oil_change', 'Change Engine oil & Check Level', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', 'generator.engine_oil_changed', 4),
    ('GENERATOR', 'gen_fuel_filter_change', 'Fuel Filter Change', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', 'generator.fuel_filter_changed', 5),
    ('GENERATOR', 'gen_oil_filter_change', 'Oil Filter Change', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', 'generator.oil_filter_changed', 6),
    ('GENERATOR', 'gen_air_filter_ok', 'Air filter clean and intact', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 7),
    ('GENERATOR', 'gen_breakers_power_cable', 'Check Breakers & Power Cable', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 8),
    ('GENERATOR', 'gen_radiator', 'Check Radiator', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 9),
    ('GENERATOR', 'gen_solenoid', 'Is the Solenoid Connected & Operational?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 10),
    ('GENERATOR', 'gen_battery_charger', 'Battery charger operational', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 11),
    ('GENERATOR', 'gen_oil_sensor_protection', 'Check Oil Sensor Protection', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 12),
    ('GENERATOR', 'gen_radiator_hose', 'Radiator hose free from cracks, no leaks', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 13),
    ('GENERATOR', 'gen_burning_oil', 'Is The Machine burning Oil?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', null, 14),
    ('GENERATOR', 'gen_battery_terminals', 'Are battery terminals clean and properly connected?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 15),
    ('GENERATOR', 'gen_charging_system', 'Is the generator charging system working properly?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 16),

    -- DC SYSTEM --------------------------------------------------------------
    ('DC_SYSTEM', 'dc_rectifier_modules_operational', 'All rectifier modules operational', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 1),
    ('DC_SYSTEM', 'dc_breakers_labeled', 'Breakers properly labeled', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 2),
    ('DC_SYSTEM', 'dc_cables_condition', 'DC cables in good condition', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 3),
    ('DC_SYSTEM', 'dc_alarms_tested', 'Alarms tested and functional', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 4),
    ('DC_SYSTEM', 'dc_grounding_secure', 'Grounding connections secure', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 5),
    ('DC_SYSTEM', 'dc_phase_1_amps', 'Clamp Meter Amp Load - Phase 1', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 1}', 'dc.phase_current', 6),
    ('DC_SYSTEM', 'dc_phase_2_amps', 'Clamp Meter Amp Load - Phase 2', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 2}', 'dc.phase_current', 7),
    ('DC_SYSTEM', 'dc_phase_3_amps', 'Clamp Meter Amp Load - Phase 3', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 3}', 'dc.phase_current', 8),
    ('DC_SYSTEM', 'dc_phase_4_amps', 'Clamp Meter Amp Load - Phase 4', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 4}', 'dc.phase_current', 9),
    ('DC_SYSTEM', 'dc_phase_5_amps', 'Clamp Meter Amp Load - Phase 5', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 5}', 'dc.phase_current', 10),
    ('DC_SYSTEM', 'dc_phase_6_amps', 'Clamp Meter Amp Load - Phase 6', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 6}', 'dc.phase_current', 11),
    ('DC_SYSTEM', 'dc_phase_7_amps', 'Clamp Meter Amp Load - Phase 7', 'NUMBER', 'A', 0, false, null, '{}', '{}', null, 'Leave blank if this phase is not present on site.', '{"phase_number": 7}', 'dc.phase_current', 12),
    ('DC_SYSTEM', 'dc_rectifier_alarm', 'Is there any rectifier alarm or fault?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', null, 13),
    ('DC_SYSTEM', 'dc_rectifier_clean', 'Is the rectifier clean and free from excessive dust?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 14),
    ('DC_SYSTEM', 'dc_abnormal_findings', 'Are there any abnormal technical findings?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', null, 15),

    -- BATTERY ----------------------------------------------------------------
    ('BATTERY', 'bat_physically_inspected', 'Is the battery bank physically inspected?', 'YES_NO_NA', null, null, true, null, '{}', '{NO}', null, null, '{}', null, 1),
    ('BATTERY', 'bat_good_condition', 'Are all batteries in good physical condition?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 2),
    ('BATTERY', 'bat_swelling_leakage', 'Is there any swelling, leakage, corrosion, or damage?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', 'battery.physical_damage_found', 3),
    ('BATTERY', 'bat_terminals', 'Are battery terminals clean and properly connected?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 4),
    ('BATTERY', 'bat_water_top_up', 'Does the battery require water top-up?', 'YES_NO_NA', null, null, true, null, '{}', '{YES}', null, 'If YES, record the action taken.', '{}', 'battery.water_top_up_required', 5),
    ('BATTERY', 'bat_voltage_each', 'Voltage from each battery', 'YES_NO_NA', null, null, true, null, '{}', '{YES}', null, 'If measured, record each battery voltage in the comment.', '{}', null, 6),
    ('BATTERY', 'bat_racks_secure', 'Battery racks secure', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 7),
    ('BATTERY', 'bat_room_ventilated', 'Is the battery room/rack clean and properly ventilated?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 8),

    -- SOLAR ------------------------------------------------------------------
    ('SOLAR', 'sol_physically_inspected', 'Are all solar panels physically inspected?', 'YES_NO_NA', null, null, true, null, '{}', '{NO}', null, null, '{}', null, 1),
    ('SOLAR', 'sol_cleaned_during_pm', 'Were the solar panels cleaned during PM?', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', 'solar.panels_cleaned', 2),
    ('SOLAR', 'sol_panels_clean', 'Are the solar panels clean?', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', null, 3),
    ('SOLAR', 'sol_free_of_debris', 'Panels clean and free of debris', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', null, 4),
    ('SOLAR', 'sol_obstruction_shadow', 'Check if there is any obstruction or shadow', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, 'Answer YES if an obstruction or shadow is present.', '{}', null, 5),
    ('SOLAR', 'sol_damaged_panel_count', 'Number of Damaged Solar Panels on Site', 'NUMBER', null, 0, true, null, '{}', '{}', null, null, '{"integer": true}', 'solar.damaged_panel_count', 6),
    ('SOLAR', 'sol_charge_controller', 'Charge controller functioning', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 7),
    ('SOLAR', 'sol_wiring_intact', 'Wiring and connectors intact', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 8),
    ('SOLAR', 'sol_cables_secured', 'Are solar cables properly secured?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 9),
    ('SOLAR', 'sol_junction_points', 'Are connectors and junction points in good condition?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 10),
    ('SOLAR', 'sol_operating_normally', 'Is the solar system operating normally?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', 'solar.system_operating_normally', 11),
    ('SOLAR', 'sol_abnormal_findings', 'Are there any abnormal solar-system findings?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', null, 12),

    -- NON-TECHNICAL OBSERVATIONS ---------------------------------------------
    ('NON_TECHNICAL', 'nt_power_equipment_cleaned', 'Was all power equipment cleaned?', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', null, 1),
    ('NON_TECHNICAL', 'nt_dust_removed', 'Was excessive dust removed from the equipment?', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', null, 2),
    ('NON_TECHNICAL', 'nt_shelter_cleaned', 'Shelter / cabinet cleaned', 'YES_NO_NA', null, null, true, null, '{}', '{}', null, null, '{}', null, 3),
    ('NON_TECHNICAL', 'nt_vegetation_clear', 'Site clear of vegetation', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 4),
    ('NON_TECHNICAL', 'nt_no_debris', 'No debris or waste on site', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 5),
    ('NON_TECHNICAL', 'nt_cable_trays', 'Cable trays clean and organized', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 6),
    ('NON_TECHNICAL', 'nt_fence_gate', 'Fence and gate in good condition', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 7),
    ('NON_TECHNICAL', 'nt_missing_stolen', 'Is any equipment or cable missing/stolen?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', null, 8),
    ('NON_TECHNICAL', 'nt_security_lights', 'Are security lights working?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 9),
    ('NON_TECHNICAL', 'nt_aviation_lights', 'Are navigation/aviation lights working where applicable?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, 'Select N/A if the site has no navigation/aviation lights.', '{}', null, 10),
    ('NON_TECHNICAL', 'nt_locks_secure', 'Are locks and access points secure?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', null, 11),
    ('NON_TECHNICAL', 'nt_oil_fuel_spill', 'Is there any oil/fuel spill?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', null, 12),
    ('NON_TECHNICAL', 'nt_fire_extinguisher', 'Is there Fire Extinguisher on Site?', 'YES_NO_NA', null, null, true, 'NO', '{YES}', '{}', 'Photo must clearly show the fire extinguisher expiry date.', null, '{}', null, 13),

    -- EARTHING / GROUNDING ---------------------------------------------------
    ('EARTHING', 'earth_inspected', 'Was the site earthing system inspected?', 'YES_NO_NA', null, null, true, null, '{}', '{NO}', null, null, '{}', 'earthing.inspected', 1),
    ('EARTHING', 'earth_cable_connected', 'Is the earth cable properly connected?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', 'earthing.earth_cable_connected', 2),
    ('EARTHING', 'earth_no_corrosion', 'Is the earth connection free from corrosion or damage?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', 'earthing.free_from_corrosion', 3),
    ('EARTHING', 'earth_pit_acceptable', 'Is the earth pit/grounding arrangement in acceptable condition?', 'YES_NO_NA', null, null, true, 'NO', '{}', '{}', null, null, '{}', 'earthing.pit_condition_acceptable', 4),
    ('EARTHING', 'earth_abnormalities', 'Are there any earthing abnormalities requiring attention?', 'YES_NO_NA', null, null, true, 'YES', '{}', '{}', null, null, '{}', 'earthing.abnormalities_found', 5)
  ) as i(section_code, code, prompt, response_type, unit, min_value, is_required, fail,
         photo_on, comment_on, photo_instructions, help_text, metadata, analytics_key, sort_order)
    on i.section_code = s.code;
