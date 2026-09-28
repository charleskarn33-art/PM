import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { SignedIn } from '../authz/decorators.js';
import { WithMeta } from '../common/envelope.js';
import { IdPipe } from '../common/id.pipe.js';
import { NotificationsService } from './notifications.service.js';

/** Everyone's own notifications and phones; nobody sees another person's. */
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** `?unread=true&page&pageSize` — newest first; `meta.unread` is the unread count. */
  @SignedIn()
  @Get('notifications')
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    const r = await this.notifications.list(query, me);
    return new WithMeta(r.items, { total: r.total, page: r.page, pageSize: r.pageSize, unread: r.unread });
  }

  @SignedIn()
  @Get('notifications/unread-count')
  async unread(@CurrentUser() me: AuthUser) {
    return { unread: await this.notifications.unreadCount(me) };
  }

  @SignedIn()
  @Post('notifications/read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentUser() me: AuthUser) {
    return this.notifications.markAllRead(me);
  }

  @SignedIn()
  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.OK)
  read(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.notifications.markRead(id, me);
  }

  /** `{ token, platform, deviceName? }` — this phone receives the caller's push notifications. */
  @SignedIn()
  @Post('push-tokens')
  @HttpCode(HttpStatus.OK)
  register(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.notifications.registerToken(body, me);
  }

  /** `{ token }` — on sign-out. */
  @SignedIn()
  @Delete('push-tokens')
  unregister(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.notifications.unregisterToken(body, me);
  }
}
