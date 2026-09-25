import { loadConfig, type AppConfig } from './config/app-config.js';
import { createApp } from './app.js';

let config: AppConfig;
try {
  config = loadConfig(process.env);
} catch (e) {
  // The message lists variable names and problems only, never values.
  console.error((e as Error).message);
  process.exit(1);
}

const app = await createApp(config);
await app.listen(config.port, '0.0.0.0');
