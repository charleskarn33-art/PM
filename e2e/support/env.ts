/**
 * Ports and names for the end-to-end environment. Imported first by every
 * support module: the database test helpers read these variables on load.
 */
export const E2E = {
  webUrl: process.env.E2E_WEB_URL ?? 'http://localhost:3200',
  gatewayPort: Number(process.env.E2E_GATEWAY_PORT ?? 54329),
  postgrestPort: Number(process.env.E2E_POSTGREST_PORT ?? 3997),
  dbName: process.env.E2E_DATABASE_NAME ?? 'ipt_pm_e2e',
  /** Password the test Auth stand-in accepts for every fixture user. */
  password: 'e2e-Password-2026',
} as const;

export const gatewayUrl = `http://localhost:${E2E.gatewayPort}`;

process.env.TEST_DATABASE_NAME = E2E.dbName;
process.env.TEST_POSTGREST_PORT = String(E2E.postgrestPort);
