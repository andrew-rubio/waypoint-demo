import { trace } from '@opentelemetry/api';
import { logger } from '../logger.js';

let initialised = false;
/** Direct handle to our provider so we can force-flush deterministically. */
let provider: { forceFlush?: () => Promise<void> } | undefined;

/**
 * Initialise OpenTelemetry tracing once, if a connection string is present
 * (INC-10, ADR-011). We build and *register* our own NodeTracerProvider with the
 * Azure Monitor trace exporter so spans created via `trace.getTracer(...)` are
 * actually recorded and exported.
 *
 * We deliberately do NOT use `@azure/monitor-opentelemetry`'s `useAzureMonitor`:
 * in this version it does not set the global API tracer provider, so
 * manually-created GenAI spans resolve to a no-op ProxyTracerProvider and never
 * export (verified: `isRecording === false`). Registering our own provider is
 * explicit and reliable.
 *
 * Foundry reserves `APPLICATIONINSIGHTS_*`, so we also accept a `WAYPOINT_` alias
 * when the platform doesn't inject the string. If neither is set, telemetry is a
 * no-op and the app runs unchanged.
 */
export async function initTracing(): Promise<void> {
  if (initialised) return;
  const connectionString =
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? process.env.WAYPOINT_APPINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    logger.info('Telemetry disabled (no APPLICATIONINSIGHTS_CONNECTION_STRING)');
    return;
  }
  try {
    const { AzureMonitorTraceExporter } = await import('@azure/monitor-opentelemetry-exporter');
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const { resourceFromAttributes } = await import('@opentelemetry/resources');

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'waypoint-agent';
    const exporter = new AzureMonitorTraceExporter({ connectionString });
    const tracerProvider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': serviceName }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    tracerProvider.register();
    provider = tracerProvider;
    initialised = true;

    // One-shot diagnostic: confirm a manually-created span actually records.
    const diagSpan = trace.getTracer('waypoint-diag').startSpan('telemetry.diag');
    logger.info(
      { recording: diagSpan.isRecording(), service: serviceName },
      'OpenTelemetry tracing initialised (Azure Monitor exporter)',
    );
    diagSpan.end();
    await flushTracing();
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
  if (!initialised || !provider) return;
  try {
    await provider.forceFlush?.();
  } catch (err) {
    logger.warn({ err: String(err) }, 'telemetry flush failed');
  }
}
