import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

export const PASSWORD = 'correct-horse-battery-staple';
export type Http = ReturnType<NestExpressApplication['getHttpServer']>;

/** Gives an existing user a password (as if they had set it themselves). */
export async function setPassword(prisma: PrismaService, userId: string, password = PASSWORD) {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await new PasswordService().hash(password) } });
}

export function login(http: Http, email: string, password = PASSWORD, client: 'web' | 'mobile' = 'web') {
  return request(http).post('/api/v1/auth/login').send({ email, password, client });
}

/** Signs in and returns a function that sends authenticated requests. */
export async function signIn(http: Http, email: string, password = PASSWORD) {
  const res = await login(http, email, password);
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const token: string = res.body.data.accessToken;
  const as = {
    get: (path: string) => request(http).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) => request(http).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    patch: (path: string, body: object) => request(http).patch(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path: string, body: object) => request(http).put(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    del: (path: string) => request(http).delete(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    upload: (path: string, file: Buffer, name: string, fields: Record<string, string> = {}) => {
      let r = request(http).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, { filename: name });
    },
  };
  return { ...as, session: res.body.data as { accessToken: string; refreshToken: string; user: { id: string; permissions: string[] } } };
}
