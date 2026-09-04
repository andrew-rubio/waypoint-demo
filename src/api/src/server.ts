import { createApp } from './app.js';
import { initTracing } from './telemetry/tracing.js';
import { logger } from './logger.js';

/** Process entry point. Aspire (local) and Container Apps (Azure) run this. */
const port = Number(process.env.PORT ?? 8080);

// Start telemetry before serving so agent turns are traced (INC-10, ADR-011).
await initTracing();

createApp().listen(port, () => {
  logger.info({ port }, 'Waypoint API listening');
});
