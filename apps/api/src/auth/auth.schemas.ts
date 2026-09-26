import { z } from 'zod';

/**
 * Password rules: 12–128 characters. Length is what matters most (NIST SP
 * 800-63B); no composition rules. Passwords are never trimmed or logged.
 */
export const newPassword = z
  .string()
  .min(12, 'use at least 12 characters')
  .max(128, 'use at most 128 characters');

export const LoginInput = z.strictObject({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(128),
  client: z.enum(['web', 'mobile']),
});

export const RefreshInput = z.strictObject({ refreshToken: z.string().min(1).max(2048) });

export const ChangePasswordInput = z
  .strictObject({ currentPassword: z.string().min(1).max(128), newPassword, client: z.enum(['web', 'mobile']) })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'choose a password different from the current one', path: ['newPassword'] });

export const TemporaryPasswordInput = z.strictObject({ temporaryPassword: newPassword });

export type Client = z.infer<typeof LoginInput>['client'];
