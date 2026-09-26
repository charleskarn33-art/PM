import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Settings administrators can change, with their defaults (used until first saved). */
export const SETTINGS = {
  /** PM start geofence. WARN: record and warn; REQUIRE_REASON: a reason is needed outside the radius; BLOCK: refuse. */
  geofence: {
    schema: z.strictObject({
      mode: z.enum(['WARN', 'REQUIRE_REASON', 'BLOCK']),
      radiusM: z.number().int().min(1).max(100_000),
    }),
    defaults: { mode: 'WARN' as const, radiusM: 100 },
  },
  /** PM completion rules. */
  pm: {
    schema: z.strictObject({ requireSignature: z.boolean() }),
    defaults: { requireSignature: true },
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS)[K]['schema']> };

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** All settings (saved values over defaults). */
  async all(): Promise<Settings> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: Object.keys(SETTINGS) } } });
    const out = {} as Record<string, unknown>;
    for (const [key, def] of Object.entries(SETTINGS)) {
      const saved = rows.find((r) => r.key === key)?.value;
      const parsed = def.schema.safeParse({ ...def.defaults, ...(saved && typeof saved === 'object' ? saved : {}) });
      out[key] = parsed.success ? parsed.data : def.defaults;
    }
    return out as Settings;
  }

  async get<K extends SettingKey>(key: K): Promise<Settings[K]> {
    return (await this.all())[key];
  }

  async set(key: string, input: unknown, actorId: string) {
    if (!(key in SETTINGS)) throw notFound('Setting');
    const value = parseInput(SETTINGS[key as SettingKey].schema as z.ZodType<Prisma.InputJsonObject>, input);
    await this.prisma.systemSetting.upsert({ where: { key }, create: { key, value, updatedById: actorId }, update: { value, updatedById: actorId } });
    return value;
  }
}
