/**
 * Reference PM template, version 1 — configuration, not demo data.
 *
 * Structure and wording follow the Tienii (1301) Preventative Maintenance
 * Report (2026-09-15): six sections with their readings and checklist
 * questions. Failure rules follow each question's polarity ("Is the machine
 * burning oil?" YES → failure; "Is Automation Working?" NO → failure); a
 * failure needs a comment and a photo. Every failure is MEDIUM severity until
 * an administrator sets real severities. No engineering limits: only
 * definitional bounds (percent 0–100, counts and measurements ≥ 0).
 */
import type { PmCategory, PrismaClient, ReadingValueType, ResponseType, SiteEquipment } from '../generated/prisma/client.js';

export const REFERENCE_TEMPLATE = {
  code: 'TELECOM_SITE_POWER_PM',
  name: 'Telecom Site Power Preventive Maintenance',
  description: 'Reference checklist derived from the Tienii (1301) PM report.',
};

export interface SectionDef {
  code: string;
  name: string;
  category: PmCategory;
  allowNotApplicable: boolean;
  requiresEquipment?: SiteEquipment;
}

export const REFERENCE_SECTIONS: SectionDef[] = [
  { code: 'GENERATOR', name: 'Generator', category: 'GENERATOR', allowNotApplicable: true, requiresEquipment: 'GENERATOR' },
  { code: 'DC_SYSTEM', name: 'DC System', category: 'DC_SYSTEM', allowNotApplicable: false },
  { code: 'BATTERY', name: 'Battery', category: 'BATTERY', allowNotApplicable: true },
  { code: 'SOLAR', name: 'Solar', category: 'SOLAR', allowNotApplicable: true, requiresEquipment: 'SOLAR' },
  { code: 'NON_TECHNICAL', name: 'Non-Technical Observations', category: 'NON_TECHNICAL', allowNotApplicable: false },
  { code: 'EARTHING', name: 'Earthing / Grounding', category: 'EARTHING', allowNotApplicable: false },
];

export interface ReadingDef {
  code: string;
  label: string;
  valueType?: ReadingValueType;
  unit?: string;
  isInteger?: boolean;
  minValue?: number;
  maxValue?: number;
  isRequired?: boolean;
  helpText?: string;
  analyticsKey?: string;
}

export const REFERENCE_READINGS: Record<string, ReadingDef[]> = {
  GENERATOR: [
    { code: 'running_hours', label: 'Running Hours', unit: 'h', minValue: 0, analyticsKey: 'generator.running_hours' },
    {
      code: 'oil_pressure',
      label: 'Oil Pressure',
      valueType: 'TEXT',
      helpText: 'As shown on the gauge: the value in bar, or the gauge status (e.g. "Okay").',
      analyticsKey: 'generator.oil_pressure',
    },
    { code: 'fuel_level', label: 'Fuel Level (%)', unit: '%', minValue: 0, maxValue: 100, analyticsKey: 'generator.fuel_level_pct' },
    { code: 'generator_kva', label: 'Generator KVA', unit: 'kVA', minValue: 0, analyticsKey: 'generator.generator_kva' },
  ],
  DC_SYSTEM: [
    { code: 'rectifier_output_voltage', label: 'Rectifier Output Voltage (V)', unit: 'V', minValue: 0, analyticsKey: 'dc.rectifier_voltage_v' },
    { code: 'load_current', label: 'Load Current (A)', unit: 'A', minValue: 0, analyticsKey: 'dc.load_current_a' },
    { code: 'rectifier_module_count', label: 'Number of Rectifier Modules', isInteger: true, minValue: 0, analyticsKey: 'dc.rectifier_module_count' },
    { code: 'dc_modules_installed', label: 'DC Modules Installed', isInteger: true, minValue: 0, analyticsKey: 'dc.dc_modules_installed' },
    { code: 'dc_modules_operational', label: 'DC Modules Operational', isInteger: true, minValue: 0, analyticsKey: 'dc.dc_modules_operational' },
    { code: 'controller_model', label: 'NCU / CSB / TRION Model', valueType: 'TEXT', analyticsKey: 'dc.controller_model' },
  ],
  BATTERY: [
    { code: 'battery_voltage', label: 'Battery Voltage (V)', unit: 'V', minValue: 0, analyticsKey: 'battery.battery_voltage_v' },
    { code: 'battery_capacity', label: 'Battery Capacity (Ah)', unit: 'Ah', minValue: 0, analyticsKey: 'battery.capacity_ah' },
    { code: 'battery_strings', label: 'Number of Battery Strings', isInteger: true, minValue: 0, analyticsKey: 'battery.string_count' },
  ],
  SOLAR: [
    { code: 'panels_installed', label: 'Panels Installed', isInteger: true, minValue: 0, analyticsKey: 'solar.panels_installed' },
    { code: 'panels_operational', label: 'Panels Operational', isInteger: true, minValue: 0, analyticsKey: 'solar.panels_operational' },
    { code: 'charge_controller_output', label: 'Charge Controller Output (V)', unit: 'V', minValue: 0, analyticsKey: 'solar.charge_controller_output_v' },
  ],
};

export interface ItemDef {
  code: string;
  prompt: string;
  responseType?: ResponseType;
  unit?: string;
  minValue?: number;
  isInteger?: boolean;
  isRequired?: boolean;
  failureOnAnswer?: 'YES' | 'NO';
  photoOnAnswers?: ('YES' | 'NO' | 'NA')[];
  commentOnAnswers?: ('YES' | 'NO' | 'NA')[];
  photoInstructions?: string;
  helpText?: string;
  analyticsKey?: string;
}

export const REFERENCE_ITEMS: Record<string, ItemDef[]> = {
  GENERATOR: [
    { code: "gen_physically_inspected", prompt: "Is the generator physically inspected?", commentOnAnswers: ["NO"] },
    { code: "gen_requires_service", prompt: "Does the generator require servicing or corrective maintenance?", failureOnAnswer: "YES", analyticsKey: "generator.requires_service" },
    { code: "gen_automation_working", prompt: "Is Automation Working?", failureOnAnswer: "NO" },
    { code: "gen_engine_oil_change", prompt: "Change Engine oil & Check Level", analyticsKey: "generator.engine_oil_changed" },
    { code: "gen_fuel_filter_change", prompt: "Fuel Filter Change", analyticsKey: "generator.fuel_filter_changed" },
    { code: "gen_oil_filter_change", prompt: "Oil Filter Change", analyticsKey: "generator.oil_filter_changed" },
    { code: "gen_air_filter_ok", prompt: "Air filter clean and intact", failureOnAnswer: "NO" },
    { code: "gen_breakers_power_cable", prompt: "Check Breakers & Power Cable", failureOnAnswer: "NO" },
    { code: "gen_radiator", prompt: "Check Radiator", failureOnAnswer: "NO" },
    { code: "gen_solenoid", prompt: "Is the Solenoid Connected & Operational?", failureOnAnswer: "NO" },
    { code: "gen_battery_charger", prompt: "Battery charger operational", failureOnAnswer: "NO" },
    { code: "gen_oil_sensor_protection", prompt: "Check Oil Sensor Protection", failureOnAnswer: "NO" },
    { code: "gen_radiator_hose", prompt: "Radiator hose free from cracks, no leaks", failureOnAnswer: "NO" },
    { code: "gen_burning_oil", prompt: "Is The Machine burning Oil?", failureOnAnswer: "YES" },
    { code: "gen_battery_terminals", prompt: "Are battery terminals clean and properly connected?", failureOnAnswer: "NO" },
    { code: "gen_charging_system", prompt: "Is the generator charging system working properly?", failureOnAnswer: "NO" },
  ],
  DC_SYSTEM: [
    { code: "dc_rectifier_modules_operational", prompt: "All rectifier modules operational", failureOnAnswer: "NO" },
    { code: "dc_breakers_labeled", prompt: "Breakers properly labeled", failureOnAnswer: "NO" },
    { code: "dc_cables_condition", prompt: "DC cables in good condition", failureOnAnswer: "NO" },
    { code: "dc_alarms_tested", prompt: "Alarms tested and functional", failureOnAnswer: "NO" },
    { code: "dc_grounding_secure", prompt: "Grounding connections secure", failureOnAnswer: "NO" },
    { code: "dc_phase_1_amps", prompt: "Clamp Meter Amp Load - Phase 1", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_phase_2_amps", prompt: "Clamp Meter Amp Load - Phase 2", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_phase_3_amps", prompt: "Clamp Meter Amp Load - Phase 3", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_phase_4_amps", prompt: "Clamp Meter Amp Load - Phase 4", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_phase_5_amps", prompt: "Clamp Meter Amp Load - Phase 5", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_phase_6_amps", prompt: "Clamp Meter Amp Load - Phase 6", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_phase_7_amps", prompt: "Clamp Meter Amp Load - Phase 7", responseType: "NUMBER", unit: "A", minValue: 0, isRequired: false, helpText: "Leave blank if this phase is not present on site.", analyticsKey: "dc.phase_current" },
    { code: "dc_rectifier_alarm", prompt: "Is there any rectifier alarm or fault?", failureOnAnswer: "YES" },
    { code: "dc_rectifier_clean", prompt: "Is the rectifier clean and free from excessive dust?", failureOnAnswer: "NO" },
    { code: "dc_abnormal_findings", prompt: "Are there any abnormal technical findings?", failureOnAnswer: "YES" },
  ],
  BATTERY: [
    { code: "bat_physically_inspected", prompt: "Is the battery bank physically inspected?", commentOnAnswers: ["NO"] },
    { code: "bat_good_condition", prompt: "Are all batteries in good physical condition?", failureOnAnswer: "NO" },
    { code: "bat_swelling_leakage", prompt: "Is there any swelling, leakage, corrosion, or damage?", failureOnAnswer: "YES", analyticsKey: "battery.physical_damage_found" },
    { code: "bat_terminals", prompt: "Are battery terminals clean and properly connected?", failureOnAnswer: "NO" },
    { code: "bat_water_top_up", prompt: "Does the battery require water top-up?", commentOnAnswers: ["YES"], helpText: "If YES, record the action taken.", analyticsKey: "battery.water_top_up_required" },
    { code: "bat_voltage_each", prompt: "Voltage from each battery", commentOnAnswers: ["YES"], helpText: "If measured, record each battery voltage in the comment." },
    { code: "bat_racks_secure", prompt: "Battery racks secure", failureOnAnswer: "NO" },
    { code: "bat_room_ventilated", prompt: "Is the battery room/rack clean and properly ventilated?", failureOnAnswer: "NO" },
  ],
  SOLAR: [
    { code: "sol_physically_inspected", prompt: "Are all solar panels physically inspected?", commentOnAnswers: ["NO"] },
    { code: "sol_cleaned_during_pm", prompt: "Were the solar panels cleaned during PM?", analyticsKey: "solar.panels_cleaned" },
    { code: "sol_panels_clean", prompt: "Are the solar panels clean?" },
    { code: "sol_free_of_debris", prompt: "Panels clean and free of debris" },
    { code: "sol_obstruction_shadow", prompt: "Check if there is any obstruction or shadow", failureOnAnswer: "YES", helpText: "Answer YES if an obstruction or shadow is present." },
    { code: "sol_damaged_panel_count", prompt: "Number of Damaged Solar Panels on Site", responseType: "NUMBER", minValue: 0, isInteger: true, analyticsKey: "solar.damaged_panel_count" },
    { code: "sol_charge_controller", prompt: "Charge controller functioning", failureOnAnswer: "NO" },
    { code: "sol_wiring_intact", prompt: "Wiring and connectors intact", failureOnAnswer: "NO" },
    { code: "sol_cables_secured", prompt: "Are solar cables properly secured?", failureOnAnswer: "NO" },
    { code: "sol_junction_points", prompt: "Are connectors and junction points in good condition?", failureOnAnswer: "NO" },
    { code: "sol_operating_normally", prompt: "Is the solar system operating normally?", failureOnAnswer: "NO", analyticsKey: "solar.system_operating_normally" },
    { code: "sol_abnormal_findings", prompt: "Are there any abnormal solar-system findings?", failureOnAnswer: "YES" },
  ],
  NON_TECHNICAL: [
    { code: "nt_power_equipment_cleaned", prompt: "Was all power equipment cleaned?" },
    { code: "nt_dust_removed", prompt: "Was excessive dust removed from the equipment?" },
    { code: "nt_shelter_cleaned", prompt: "Shelter / cabinet cleaned" },
    { code: "nt_vegetation_clear", prompt: "Site clear of vegetation", failureOnAnswer: "NO" },
    { code: "nt_no_debris", prompt: "No debris or waste on site", failureOnAnswer: "NO" },
    { code: "nt_cable_trays", prompt: "Cable trays clean and organized", failureOnAnswer: "NO" },
    { code: "nt_fence_gate", prompt: "Fence and gate in good condition", failureOnAnswer: "NO" },
    { code: "nt_missing_stolen", prompt: "Is any equipment or cable missing/stolen?", failureOnAnswer: "YES" },
    { code: "nt_security_lights", prompt: "Are security lights working?", failureOnAnswer: "NO" },
    { code: "nt_aviation_lights", prompt: "Are navigation/aviation lights working where applicable?", failureOnAnswer: "NO", helpText: "Select N/A if the site has no navigation/aviation lights." },
    { code: "nt_locks_secure", prompt: "Are locks and access points secure?", failureOnAnswer: "NO" },
    { code: "nt_oil_fuel_spill", prompt: "Is there any oil/fuel spill?", failureOnAnswer: "YES" },
    { code: "nt_fire_extinguisher", prompt: "Is there Fire Extinguisher on Site?", failureOnAnswer: "NO", photoOnAnswers: ["YES"], photoInstructions: "Photo must clearly show the fire extinguisher expiry date." },
  ],
  EARTHING: [
    { code: "earth_inspected", prompt: "Was the site earthing system inspected?", commentOnAnswers: ["NO"], analyticsKey: "earthing.inspected" },
    { code: "earth_cable_connected", prompt: "Is the earth cable properly connected?", failureOnAnswer: "NO", analyticsKey: "earthing.earth_cable_connected" },
    { code: "earth_no_corrosion", prompt: "Is the earth connection free from corrosion or damage?", failureOnAnswer: "NO", analyticsKey: "earthing.free_from_corrosion" },
    { code: "earth_pit_acceptable", prompt: "Is the earth pit/grounding arrangement in acceptable condition?", failureOnAnswer: "NO", analyticsKey: "earthing.pit_condition_acceptable" },
    { code: "earth_abnormalities", prompt: "Are there any earthing abnormalities requiring attention?", failureOnAnswer: "YES", analyticsKey: "earthing.abnormalities_found" },
  ],};

/** Definitional relationships only (no engineering thresholds). */
export const REFERENCE_CONSISTENCY_RULES = [
  { lhsKey: 'dc.dc_modules_operational', operator: '<=', rhsKey: 'dc.dc_modules_installed', message: 'DC Modules Operational cannot exceed DC Modules Installed.' },
  { lhsKey: 'solar.panels_operational', operator: '<=', rhsKey: 'solar.panels_installed', message: 'Panels Operational cannot exceed Panels Installed.' },
  { lhsKey: 'solar.damaged_panel_count', operator: '<=', rhsKey: 'solar.panels_installed', message: 'Damaged solar panels cannot exceed Panels Installed.' },
];

/**
 * Creates version 1 of the reference template (ACTIVE) when no template with
 * its code exists, and the consistency rules that are missing. Never changes
 * what administrators have edited since. Idempotent.
 */
export async function seedReferenceTemplate(prisma: PrismaClient): Promise<{ templateCreated: boolean; rulesCreated: number }> {
  return prisma.$transaction(async (tx) => {
    let rulesCreated = 0;
    for (const r of REFERENCE_CONSISTENCY_RULES) {
      const exists = await tx.pmConsistencyRule.findUnique({ where: { lhsKey_operator_rhsKey: { lhsKey: r.lhsKey, operator: r.operator, rhsKey: r.rhsKey } } });
      if (!exists) {
        await tx.pmConsistencyRule.create({ data: r });
        rulesCreated += 1;
      }
    }
    if (await tx.pmTemplate.findFirst({ where: { code: REFERENCE_TEMPLATE.code } })) return { templateCreated: false, rulesCreated };

    // Built as a DRAFT (structure can only change in drafts), then activated.
    const template = await tx.pmTemplate.create({ data: { ...REFERENCE_TEMPLATE, version: 1, status: 'DRAFT' } });
    for (const [i, s] of REFERENCE_SECTIONS.entries()) {
      const section = await tx.pmSection.create({
        data: {
          templateId: template.id,
          code: s.code,
          name: s.name,
          category: s.category,
          sortOrder: i + 1,
          allowNotApplicable: s.allowNotApplicable,
          requiresEquipment: s.requiresEquipment ?? null,
        },
      });
      await tx.pmReadingField.createMany({
        data: (REFERENCE_READINGS[s.code] ?? []).map((r, j) => ({
          sectionId: section.id,
          code: r.code,
          label: r.label,
          valueType: r.valueType ?? 'NUMBER',
          unit: r.unit ?? null,
          isInteger: r.isInteger ?? false,
          minValue: r.minValue ?? null,
          maxValue: r.maxValue ?? null,
          isRequired: r.isRequired ?? true,
          helpText: r.helpText ?? null,
          analyticsKey: r.analyticsKey ?? null,
          sortOrder: j + 1,
        })),
      });
      await tx.pmChecklistItem.createMany({
        data: (REFERENCE_ITEMS[s.code] ?? []).map((it, j) => ({
          sectionId: section.id,
          code: it.code,
          prompt: it.prompt,
          helpText: it.helpText ?? null,
          responseType: it.responseType ?? 'YES_NO_NA',
          allowNotApplicable: true,
          isRequired: it.isRequired ?? true,
          unit: it.unit ?? null,
          minValue: it.minValue ?? null,
          isInteger: it.isInteger ?? false,
          failureOnAnswer: it.failureOnAnswer ?? null,
          failureSeverity: 'MEDIUM',
          requiresCommentOnFailure: Boolean(it.failureOnAnswer),
          requiresPhotoOnFailure: Boolean(it.failureOnAnswer),
          photoOnAnswers: it.photoOnAnswers ?? [],
          commentOnAnswers: it.commentOnAnswers ?? [],
          photoInstructions: it.photoInstructions ?? null,
          analyticsKey: it.analyticsKey ?? null,
          sortOrder: j + 1,
        })),
      });
    }
    await tx.pmTemplate.update({ where: { id: template.id }, data: { status: 'ACTIVE', activatedAt: new Date() } });
    return { templateCreated: true, rulesCreated };
  });
}
