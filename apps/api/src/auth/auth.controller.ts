import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AllowPendingPasswordChange, AuthThrottle, SignedIn } from '../authz/decorators.js';
import { CurrentUser, type AuthUser } from './auth-user.js';
import { clientIp } from '../common/client-ip.js';
import { AppConfig } from '../config/app-config.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { Public } from './public.decorator.js';

/**
 * Sessions. Tokens are returned in the body: the mobile app keeps them in
 * SecureStore; the web app's server keeps them in httpOnly cookies and never
 * exposes them to page scripts.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  private meta(req: Request): RequestMeta {
    return { userAgent: req.get('user-agent') ?? undefined, ip: clientIp(req, this.config.webForwardSecret) };
  }

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(body, this.meta(req));
  }

  @Public()
  @AuthThrottle()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: unknown, @Req() req: Request) {
    return this.auth.refresh(body, this.meta(req));
  }

  /** Public so a client whose access token has expired can still sign out. */
  @Public()
  @AuthThrottle()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown): Promise<void> {
    await this.auth.logout(body);
  }

  @SignedIn()
  @AllowPendingPasswordChange()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logoutAll(user.id);
  }

  @SignedIn()
  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @SignedIn()
  @AllowPendingPasswordChange()
  @AuthThrottle()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    return this.auth.changePassword(user.id, body, this.meta(req));
  }
}
