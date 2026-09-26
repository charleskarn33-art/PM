/**
 * Power-module records built from a visit's keyed values (the template's
 * analytics keys). Pure: no database. Measured values are copied unchanged;
 * calculated values are exact decimals (never binary floating point):
 *   DC power (kW) = rectifier voltage (V) × load current (A) / 1000
 *   total phase current (A) = sum of the recorded clamp-meter phases
 * A module exists when the visit has an applicable section of its category.
 */
import { Prisma, type Answer, type PmCategory } from '../generated/prisma/client.js';

type Dec = Prisma.Decimal;

export interface KeyedValue {
  key: string;
  category: PmCategory;
  num: Dec | null;
  text: string | null;
  answer: Answer | null;
  comment: string | null;
}

export interface BatteryUnit {
  unitNumber: number;
  voltageV: Dec;
}

export interface ModuleRecords {
  generator: {
    runningHours: Dec | null;
    oilPressure: string | null;
    oilPressureBar: Dec | null;
    fuelLevelPct: Dec | null;
    generatorKva: Dec | null;
    engineOilChanged: boolean | null;
    fuelFilterChanged: boolean | null;
    oilFilterChanged: boolean | null;
    requiresService: boolean | null;
  } | null;
  dc: {
    rectifierVoltageV: Dec | null;
    loadCurrentA: Dec | null;
    rectifierModuleCount: number | null;
    dcModulesInstalled: number | null;
    dcModulesOperational: number | null;
    controllerModel: string | null;
    dcPowerKw: Dec | null;
    totalPhaseCurrentA: Dec | null;
    phasesRecorded: number;
  } | null;
  dcPhases: { phaseNumber: number; ampValue: Dec; comment: string | null }[];
  battery: {
    batteryVoltageV: Dec | null;
    capacityAh: Dec | null;
    stringCount: number | null;
    physicalDamageFound: boolean | null;
    waterTopUpRequired: boolean | null;
    unitsRecorded: number;
    minUnitVoltageV: Dec | null;
    maxUnitVoltageV: Dec | null;
  } | null;
  solar: {
    panelsInstalled: number | null;
    panelsOperational: number | null;
    damagedPanelCount: number | null;
    chargeControllerOutputV: Dec | null;
    panelsCleaned: boolean | null;
    systemOperatingNormally: boolean | null;
  } | null;
  nonTechnical: Record<(typeof NON_TECHNICAL_KEYS)[number][1], boolean | null> | null;
  earthing: {
    inspected: boolean | null;
    earthCableConnected: boolean | null;
    freeFromCorrosion: boolean | null;
    pitConditionAcceptable: boolean | null;
    abnormalitiesFound: boolean | null;
  } | null;
}

export const NON_TECHNICAL_KEYS = [
  ['non_technical.power_equipment_cleaned', 'powerEquipmentCleaned'],
  ['non_technical.dust_removed', 'dustRemoved'],
  ['non_technical.shelter_cleaned', 'shelterCleaned'],
  ['non_technical.vegetation_clear', 'vegetationClear'],
  ['non_technical.free_of_debris', 'freeOfDebris'],
  ['non_technical.cable_trays_organised', 'cableTraysOrganised'],
  ['non_technical.fence_gate_good', 'fenceGateGood'],
  ['non_technical.equipment_missing', 'equipmentMissing'],
  ['non_technical.security_lights_working', 'securityLightsWorking'],
  ['non_technical.aviation_lights_working', 'aviationLightsWorking'],
  ['non_technical.locks_secure', 'locksSecure'],
  ['non_technical.oil_fuel_spill', 'oilFuelSpill'],
  ['non_technical.fire_extinguisher_present', 'fireExtinguisherPresent'],
] as const;

const PHASE_KEY = /^dc\.phase_current\.(\d{1,2})$/;

/** DC power in kW, rounded half-up to 6 decimals; null without both measurements. */
export function dcPowerKw(voltageV: Dec | null, currentA: Dec | null): Dec | null {
  if (voltageV == null || currentA == null) return null;
  return voltageV.mul(currentA).div(1000).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

export function buildModules(values: readonly KeyedValue[], categories: ReadonlySet<PmCategory>, units: readonly BatteryUnit[] = []): ModuleRecords {
  const byKey = new Map<string, KeyedValue[]>();
  for (const v of values) byKey.set(v.key, [...(byKey.get(v.key) ?? []), v]);
  const num = (key: string) => byKey.get(key)?.find((v) => v.num != null)?.num ?? null;
  const int = (key: string) => {
    const n = num(key);
    return n != null && n.isInteger() ? n.toNumber() : null; // a count that is not whole is not copied
  };
  const text = (key: string) => {
    const v = byKey.get(key)?.find((x) => x.text != null || x.num != null);
    return v ? (v.text ?? v.num!.toString()) : null;
  };
  const bool = (key: string) => {
    const a = byKey.get(key)?.find((v) => v.answer === 'YES' || v.answer === 'NO')?.answer;
    return a === 'YES' ? true : a === 'NO' ? false : null;
  };

  const phases = categories.has('DC_SYSTEM')
    ? values
        .flatMap((v) => {
          const m = PHASE_KEY.exec(v.key);
          return m && v.num != null ? [{ phaseNumber: Number(m[1]), ampValue: v.num, comment: v.comment }] : [];
        })
        .filter((p, i, all) => p.phaseNumber >= 1 && all.findIndex((q) => q.phaseNumber === p.phaseNumber) === i)
        .sort((a, b) => a.phaseNumber - b.phaseNumber)
    : [];
  const voltage = num('dc.rectifier_voltage_v');
  const current = num('dc.load_current_a');
  const unitVoltages = units.map((u) => u.voltageV);

  return {
    generator: categories.has('GENERATOR')
      ? {
          runningHours: num('generator.running_hours'),
          oilPressure: text('generator.oil_pressure'),
          oilPressureBar: num('generator.oil_pressure_bar'),
          fuelLevelPct: num('generator.fuel_level_pct'),
          generatorKva: num('generator.generator_kva'),
          engineOilChanged: bool('generator.engine_oil_changed'),
          fuelFilterChanged: bool('generator.fuel_filter_changed'),
          oilFilterChanged: bool('generator.oil_filter_changed'),
          requiresService: bool('generator.requires_service'),
        }
      : null,
    dc: categories.has('DC_SYSTEM')
      ? {
          rectifierVoltageV: voltage,
          loadCurrentA: current,
          rectifierModuleCount: int('dc.rectifier_module_count'),
          dcModulesInstalled: int('dc.dc_modules_installed'),
          dcModulesOperational: int('dc.dc_modules_operational'),
          controllerModel: text('dc.controller_model'),
          dcPowerKw: dcPowerKw(voltage, current),
          totalPhaseCurrentA: phases.length ? phases.reduce((sum, p) => sum.add(p.ampValue), new Prisma.Decimal(0)) : null,
          phasesRecorded: phases.length,
        }
      : null,
    dcPhases: phases,
    battery: categories.has('BATTERY')
      ? {
          batteryVoltageV: num('battery.battery_voltage_v'),
          capacityAh: num('battery.capacity_ah'),
          stringCount: int('battery.string_count'),
          physicalDamageFound: bool('battery.physical_damage_found'),
          waterTopUpRequired: bool('battery.water_top_up_required'),
          unitsRecorded: units.length,
          minUnitVoltageV: unitVoltages.length ? Prisma.Decimal.min(...unitVoltages) : null,
          maxUnitVoltageV: unitVoltages.length ? Prisma.Decimal.max(...unitVoltages) : null,
        }
      : null,
    solar: categories.has('SOLAR')
      ? {
          panelsInstalled: int('solar.panels_installed'),
          panelsOperational: int('solar.panels_operational'),
          damagedPanelCount: int('solar.damaged_panel_count'),
          chargeControllerOutputV: num('solar.charge_controller_output_v'),
          panelsCleaned: bool('solar.panels_cleaned'),
          systemOperatingNormally: bool('solar.system_operating_normally'),
        }
      : null,
    nonTechnical: categories.has('NON_TECHNICAL')
      ? (Object.fromEntries(NON_TECHNICAL_KEYS.map(([key, field]) => [field, bool(key)])) as NonNullable<ModuleRecords['nonTechnical']>)
      : null,
    earthing: categories.has('EARTHING')
      ? {
          inspected: bool('earthing.inspected'),
          earthCableConnected: bool('earthing.earth_cable_connected'),
          freeFromCorrosion: bool('earthing.free_from_corrosion'),
          pitConditionAcceptable: bool('earthing.pit_condition_acceptable'),
          abnormalitiesFound: bool('earthing.abnormalities_found'),
        }
      : null,
  };
}
