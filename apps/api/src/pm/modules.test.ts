import { describe, expect, it } from 'vitest';
import { Prisma, type PmCategory } from '../generated/prisma/client.js';
import { buildModules, dcPowerKw, type KeyedValue } from './modules.js';

const D = (v: string | number) => new Prisma.Decimal(v);
const kv = (key: string, category: PmCategory, over: Partial<KeyedValue> = {}): KeyedValue => ({ key, category, num: null, text: null, answer: null, comment: null, ...over });
const ALL = new Set<PmCategory>(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING']);

describe('DC power', () => {
  it('is voltage × current / 1000 in exact decimals', () => {
    expect(dcPowerKw(D('52.99'), D('52.7'))!.toString()).toBe('2.792573');
    // Floating point would give 0.30000000000000004 for 0.1 + 0.2 style cases; decimals do not drift.
    expect(dcPowerKw(D('0.1'), D('3000'))!.toString()).toBe('0.3');
    expect(dcPowerKw(D('48.123456'), D('1.000001'))!.toString()).toBe('0.048124'); // 0.0481235041… rounded half-up
    expect(dcPowerKw(null, D(1))).toBeNull();
  });
});

describe('buildModules', () => {
  it('copies the Tienii readings and calculates DC figures separately', () => {
    const m = buildModules(
      [
        kv('generator.running_hours', 'GENERATOR', { num: D(877) }),
        kv('generator.oil_pressure', 'GENERATOR', { text: 'Okay' }),
        kv('generator.fuel_level_pct', 'GENERATOR', { num: D('12.7') }),
        kv('generator.generator_kva', 'GENERATOR', { num: D(20) }),
        kv('generator.requires_service', 'GENERATOR', { answer: 'NO' }),
        kv('dc.rectifier_voltage_v', 'DC_SYSTEM', { num: D('52.99') }),
        kv('dc.load_current_a', 'DC_SYSTEM', { num: D('52.7') }),
        kv('dc.rectifier_module_count', 'DC_SYSTEM', { num: D(6) }),
        kv('dc.dc_modules_installed', 'DC_SYSTEM', { num: D(3) }),
        kv('dc.dc_modules_operational', 'DC_SYSTEM', { num: D(3) }),
        kv('dc.phase_current.3', 'DC_SYSTEM', { num: D('10.5'), comment: 'rectifier 3' }),
        kv('dc.phase_current.1', 'DC_SYSTEM', { num: D('12.25') }),
        kv('dc.phase_current.2', 'DC_SYSTEM'), // not present on site: left blank
        kv('battery.battery_voltage_v', 'BATTERY', { num: D('52.5') }),
        kv('battery.capacity_ah', 'BATTERY', { num: D(200) }),
        kv('battery.string_count', 'BATTERY', { num: D(8) }),
        kv('non_technical.fire_extinguisher_present', 'NON_TECHNICAL', { answer: 'YES' }),
        kv('non_technical.aviation_lights_working', 'NON_TECHNICAL', { answer: 'NA' }),
        kv('earthing.abnormalities_found', 'EARTHING', { answer: 'NO' }),
      ],
      new Set<PmCategory>(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'NON_TECHNICAL', 'EARTHING']),
      [
        { unitNumber: 1, voltageV: D('13.1') },
        { unitNumber: 2, voltageV: D('12.9') },
      ],
    );
    expect(m.generator).toMatchObject({ oilPressure: 'Okay', requiresService: false, engineOilChanged: null });
    expect(m.generator!.runningHours!.toString()).toBe('877');
    expect(m.generator!.fuelLevelPct!.toString()).toBe('12.7');
    expect(m.dc).toMatchObject({ rectifierModuleCount: 6, dcModulesInstalled: 3, dcModulesOperational: 3, phasesRecorded: 2 });
    expect(m.dc!.dcPowerKw!.toString()).toBe('2.792573');
    expect(m.dc!.totalPhaseCurrentA!.toString()).toBe('22.75');
    expect(m.dc!.rectifierVoltageV!.toString()).toBe('52.99'); // measured value unchanged
    expect(m.dcPhases.map((p) => [p.phaseNumber, p.ampValue.toString(), p.comment])).toEqual([
      [1, '12.25', null],
      [3, '10.5', 'rectifier 3'],
    ]);
    expect(m.battery).toMatchObject({ stringCount: 8, unitsRecorded: 2 });
    expect([m.battery!.minUnitVoltageV!.toString(), m.battery!.maxUnitVoltageV!.toString()]).toEqual(['12.9', '13.1']);
    expect(m.solar).toBeNull(); // N/A at this site
    expect(m.nonTechnical).toMatchObject({ fireExtinguisherPresent: true, aviationLightsWorking: null, oilFuelSpill: null });
    expect(m.earthing).toMatchObject({ abnormalitiesFound: false, inspected: null });
  });

  it('applicable sections without answers give empty records; counts that are not whole are not copied', () => {
    const m = buildModules([kv('solar.panels_installed', 'SOLAR', { num: D('2.5') })], ALL);
    expect(m.solar).toMatchObject({ panelsInstalled: null, panelsCleaned: null });
    expect(m.dc).toMatchObject({ dcPowerKw: null, totalPhaseCurrentA: null, phasesRecorded: 0 });
    expect(m.battery).toMatchObject({ unitsRecorded: 0, minUnitVoltageV: null });
    expect(buildModules([], new Set()).generator).toBeNull();
  });
});
