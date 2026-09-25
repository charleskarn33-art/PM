import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

/**
 * Authentication foundation. Login, refresh-token rotation, logout and the
 * user tables arrive in Phase 3; secrets are passed per call by TokenService.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [PasswordService, TokenService, JwtAuthGuard],
  exports: [PasswordService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
