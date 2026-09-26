import { HttpStatus } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { AppError } from '../common/http-exception.filter.js';

/**
 * Changes that affect the whole organisation (users, roles, regions, sites)
 * are made by users with access everywhere. The catalogue grants the
 * `*.manage` permissions for these only to Super Admins; this second check
 * keeps it so even if a permission is later granted more widely.
 */
export function requireGlobal(user: AuthUser): void {
  if (!user.isGlobal) throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have permission to do this.');
}
