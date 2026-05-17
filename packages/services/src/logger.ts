import { createLogger } from '@agent-village/shared';

export const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: process.env['AV_SERVICE'] ?? 'services',
});
