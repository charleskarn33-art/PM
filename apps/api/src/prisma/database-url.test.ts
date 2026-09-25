import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from './database-url.js';

describe('poolConfigFromUrl', () => {
  it('reads host, port, credentials and database, decoding special characters', () => {
    expect(poolConfigFromUrl('mysql://ipt%40pm:p%40ss%2Fw@db.internal:3307/ipt_pm')).toMatchObject({
      host: 'db.internal',
      port: 3307,
      user: 'ipt@pm',
      password: 'p@ss/w',
      database: 'ipt_pm',
      connectionLimit: 10,
      acquireTimeout: 4000,
      allowPublicKeyRetrieval: false,
    });
  });

  it('applies supported options', () => {
    const c = poolConfigFromUrl('mysql://u:p@localhost/db?connectionLimit=20&allowPublicKeyRetrieval=true&ssl=true');
    expect(c).toMatchObject({ port: 3306, connectionLimit: 20, allowPublicKeyRetrieval: true, ssl: { rejectUnauthorized: true } });
  });

  it('rejects other protocols, a missing database and invalid numbers', () => {
    expect(() => poolConfigFromUrl('postgres://u:p@h/db')).toThrow(/mysql:\/\//);
    expect(() => poolConfigFromUrl('mysql://u:p@h/')).toThrow(/name a database/);
    expect(() => poolConfigFromUrl('mysql://u:p@h/db?connectionLimit=0')).toThrow(/connectionLimit/);
  });
});
