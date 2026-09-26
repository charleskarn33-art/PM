import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

/** Sign-in, token rotation, sign-out and the global authentication guard. Secrets are passed per call by TokenService. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [PasswordService, TokenService, AuthService, JwtAuthGuard],
  exports: [PasswordService, TokenService, AuthService, JwtAuthGuard],
})
export class AuthModule {}
