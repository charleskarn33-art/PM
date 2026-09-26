import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config.js';

const ISSUER = 'ipt-pm-api';
const AUDIENCE = 'ipt-pm';

export interface AccessClaims {
  sub: string;
  typ: 'access';
  /** Issued at in milliseconds (`iat` is whole seconds): compared with the user's sessions_valid_after. */
  ims: number;
  exp: number;
}

export interface RefreshClaims {
  sub: string;
  typ: 'refresh';
  /** Token id — the refresh_tokens row, so a token can be rotated and revoked. */
  jti: string;
  /** Rotation family: reuse of an old token revokes the whole family. */
  fam: string;
  exp: number;
}

/**
 * Signs and verifies JWTs. Access and refresh tokens use different secrets,
 * a fixed algorithm (HS256), issuer and audience, and a `typ` claim, so one
 * kind can never be accepted as the other.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ typ: 'access', ims: Date.now() }, {
      secret: this.config.jwt.accessSecret,
      algorithm: 'HS256',
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.config.jwt.accessTtlSeconds,
    });
  }

  signRefreshToken(userId: string, tokenId: string, family: string): Promise<string> {
    return this.jwt.signAsync({ typ: 'refresh', fam: family }, {
      secret: this.config.jwt.refreshSecret,
      algorithm: 'HS256',
      subject: userId,
      jwtid: tokenId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.config.jwt.refreshTtlSeconds,
    });
  }

  /** Claims of a valid, unexpired access token; null otherwise. */
  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    const claims = await this.verify(token, this.config.jwt.accessSecret);
    return claims?.typ === 'access' && typeof claims.sub === 'string' && typeof claims.ims === 'number' ? (claims as unknown as AccessClaims) : null;
  }

  /** Claims of a valid, unexpired refresh token; null otherwise. */
  async verifyRefreshToken(token: string): Promise<RefreshClaims | null> {
    const claims = await this.verify(token, this.config.jwt.refreshSecret);
    return claims?.typ === 'refresh' && typeof claims.sub === 'string' && typeof claims.jti === 'string' && typeof claims.fam === 'string'
      ? (claims as unknown as RefreshClaims)
      : null;
  }

  private async verify(token: string, secret: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.jwt.verifyAsync<Record<string, unknown>>(token, { secret, algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    } catch {
      return null;
    }
  }
}
