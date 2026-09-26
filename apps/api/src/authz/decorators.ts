import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from './catalog.js';

export const REQUIRED_PERMISSIONS = 'authz:permissions';
export const ANY_SIGNED_IN = 'authz:anySignedIn';
export const ALLOW_PENDING_PASSWORD_CHANGE = 'authz:allowPendingPasswordChange';
export const AUTH_THROTTLE = 'authz:authThrottle';

/**
 * The permissions a route needs (all of them). Every route must declare its
 * access: @RequirePermissions, @SignedIn or @Public — an undeclared route is
 * refused, so a forgotten decorator can never open an endpoint.
 */
export const RequirePermissions = (...permissions: [PermissionCode, ...PermissionCode[]]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Any signed-in, active user (e.g. their own profile); scope still applies in the service. */
export const SignedIn = () => SetMetadata(ANY_SIGNED_IN, true);

/** Reachable while the user must still replace a temporary password. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

/** Applies the stricter sign-in rate limit (AUTH_RATE_LIMIT_PER_MINUTE per IP). */
export const AuthThrottle = () => SetMetadata(AUTH_THROTTLE, true);
