import { trace } from '@opentelemetry/api';
import { logger } from '../logger.js';

let initialised = false;

/**
 * Initialise Azure Monitor OpenTelemetry once, if a connection string is present
 * (INC-10, ADR-011). Foundry Agent Service auto-injects
 * APPLICATIONINSIGHTS_CONNECTION_STRING; locally/ACA it may be unset, in which
 * case telemetry is a no-op and the app runs unchanged.
 */
export async function initTracing(): Promise<void> {
  if (initialised) return;
  // Foundry reserves APPLICATIONINSIGHTS_*, so also accept a WAYPOINT_ alias when the
  // platform doesn't inject the string (e.g. deploying into an existing project).
  const connectionString =
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? process.env.WAYPOINT_APPINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    logger.info('Telemetry disabled (no APPLICATIONINSIGHTS_CONNECTION_STRING)');
    return;
  }
  try {
    const { useAzureMonitor } = await import('@azure/monitor-opentelemetry');
    useAzureMonitor({ azureMonitorExporterOptions: { connectionString } });
    initialised = true;
    logger.info('Azure Monitor OpenTelemetry initialised');
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to initialise telemetry; continuing without it');
  }
}

/**
 * Force-export buffered spans. Hosted-agent containers pause CPU between requests,
 * so the async batch exporter never fires on its timer — flush synchronously at the
 * end of each turn while the request is still active.
 */
export async function flushTracing(): Promise<void> {
  if (!initialised) return;
  const provider = trace.getTracerProvider() as unknown as {
    getDelegate?: () => unknown;
    forceFlush?: () => Promise<void>;
  };
  const target = (typeof provider.getDelegate === 'function' ? provider.getDelegate() : provider) as {
    forceFlush?: () => Promise<void>;
  };
  try {
    await target.forceFlush?.();
  } catch (err) {
    logger.warn({ err: String(err) }, 'telemetry flush failed');
  }
}
