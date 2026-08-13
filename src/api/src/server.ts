import { createApp } from './app.js';
import { logger } from './logger.js';

/** Process entry point. Aspire (local) and Container Apps (Azure) run this. */
const port = Number(process.env.PORT ?? 8080);

createApp().listen(port, () => {
  logger.info({ port }, 'Waypoint API listening');
});
