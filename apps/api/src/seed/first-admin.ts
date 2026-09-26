import type { PrismaClient } from '../generated/prisma/client.js';
import { newPassword } from '../auth/auth.schemas.js';
import { PasswordService } from '../auth/password.service.js';

export interface FirstAdminInput {
  email: string;
  fullName: string;
  password: string;
}

/**
 * Creates the first Super Admin of a new installation — the only account
 * not created through the API. Refused once an active Super Admin exists
 * (from then on, administrators create users in the app).
 */
export async function createFirstAdmin(prisma: PrismaClient, input: FirstAdminInput): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Give a valid e-mail address.');
  if (!fullName || fullName.length > 120) throw new Error('Give the full name (1–120 characters).');
  const checked = newPassword.safeParse(input.password);
  if (!checked.success) throw new Error(`Password: ${checked.error.issues[0]!.message}.`);
  if (input.password.toLowerCase() === email) throw new Error('Password: must not be the e-mail address.');

  const hash = await new PasswordService().hash(input.password);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.count({ where: { isActive: true, roles: { some: { role: { code: 'SUPER_ADMIN' } } } } });
    if (existing > 0) throw new Error('An active Super Admin already exists. Create further users in the app.');
    const role = await tx.role.findUnique({ where: { code: 'SUPER_ADMIN' } });
    if (!role) throw new Error('Roles are missing: run `pnpm db:seed` first.');
    if (await tx.user.findUnique({ where: { email } })) throw new Error('A user with this e-mail address already exists.');
    const user = await tx.user.create({ data: { email, fullName, passwordHash: hash, passwordChangedAt: new Date() } });
    await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return { id: user.id, email: user.email };
  });
}
