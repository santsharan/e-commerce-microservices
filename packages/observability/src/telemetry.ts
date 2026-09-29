import { metrics, trace, type Counter, type Histogram, type Meter } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { KafkaJsInstrumentation } from "@opentelemetry/instrumentation-kafkajs";
import { MongoDBInstrumentation } from "@opentelemetry/instrumentation-mongodb";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { observeKafka } from "@commerce-flow/kafka";
import { MetricName } from "./names.js";

export interface TelemetryConfig {
  serviceName: string;
  otlpEndpoint?: string;
  instrument?: boolean;
}

const lags = new Map<string, number>();
let meter: Meter | undefined;
let prometheus: PrometheusExporter | undefined;
let shutdown: (() => Promise<void>) | undefined;
const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

export function startTelemetry(config: TelemetryConfig): void {
  if (shutdown !== undefined) {
    return;
  }
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });
  const readers = [];
  prometheus = new PrometheusExporter({ preventServerStart: true });
  readers.push(prometheus);
  if (config.otlpEndpoint !== undefined) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: signalUrl(config.otlpEndpoint, "metrics") }),
        exportIntervalMillis: 15_000,
      }),
    );
  }
  const meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);
  meter = metrics.getMeter("commerce-flow");
  meter.createObservableGauge(MetricName.kafkaConsumerLag).addCallback((result) => {
    for (const [key, value] of lags) {
      const split = key.indexOf("|");
      result.observe(value, {
        topic: key.slice(0, split),
        partition: key.slice(split + 1),
      });
    }
  });

  const spanProcessors = [];
  if (config.otlpEndpoint !== undefined) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: signalUrl(config.otlpEndpoint, "traces") }),
      ),
    );
  }
  const tracerProvider = new NodeTracerProvider({ resource, spanProcessors });
  tracerProvider.register();

  if (config.instrument !== false) {
    registerInstrumentations({
      tracerProvider,
      meterProvider,
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook(request) {
            const url = request.url ?? "";
            return url.startsWith("/health") || url.startsWith("/metrics");
          },
        }),
        new MongoDBInstrumentation(),
        new KafkaJsInstrumentation(),
        new RedisInstrumentation(),
      ],
    });
  }

  observeKafka((event) => {
    if (event.outcome !== undefined) {
      add(MetricName.kafkaMessagesConsumedTotal, { topic: event.topic });
      if (event.outcome === "failed") {
        add(MetricName.kafkaMessagesFailedTotal, { topic: event.topic });
      }
    }
    if (event.lag !== undefined) {
      lags.set(`${event.topic}|${event.partition}`, event.lag);
    }
  });

  shutdown = async () => {
    observeKafka(undefined);
    lags.clear();
    counters.clear();
    histograms.clear();
    meter = undefined;
    prometheus = undefined;
    await meterProvider.shutdown();
    await tracerProvider.shutdown();
  };
}

export async function shutdownTelemetry(): Promise<void> {
  const stop = shutdown;
  shutdown = undefined;
  await stop?.();
}

export function activeTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return undefined;
  }
  const traceId = span.spanContext().traceId;
  return traceId.length === 0 ? undefined : traceId;
}

export async function renderMetrics(): Promise<string> {
  const exporter = prometheus;
  if (exporter === undefined) {
    return "# Commerce Flow telemetry is not started\n";
  }
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  request.url = "/metrics";
  const response = new ServerResponse(request);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const finish = (chunk?: unknown): ServerResponse => {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
        chunks.push(Buffer.from(chunk));
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
      return response;
    };
    response.write = ((chunk: unknown) => {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
        chunks.push(Buffer.from(chunk));
      }
      return true;
    }) as ServerResponse["write"];
    response.end = finish as ServerResponse["end"];
    exporter.getMetricsRequestHandler(request, response);
  });
}

export function recordHttpRequest(input: {
  method: string;
  statusCode: number;
  durationMs: number;
}): void {
  add(MetricName.httpRequestsTotal, {
    method: input.method,
    status_code: String(input.statusCode),
  });
  record(MetricName.httpRequestDurationSeconds, input.durationMs / 1000, {
    method: input.method,
  });
}

export function recordMongoDuration(durationMs: number, commandName: string): void {
  record(MetricName.mongodbQueryDurationSeconds, durationMs / 1000, { command: commandName });
}

export function recordOrderCreated(): void {
  add(MetricName.ordersCreatedTotal);
}

export function recordOrderCompleted(): void {
  add(MetricName.ordersCompletedTotal);
}

export function recordOrderFailed(): void {
  add(MetricName.ordersFailedTotal);
}

export function recordOrderCancelled(): void {
  add(MetricName.ordersCancelledTotal);
}

export function recordSagaFailure(): void {
  add(MetricName.sagaFailuresTotal);
}

export function recordSagaDuration(startedAt: Date, endedAt: Date): void {
  record(
    MetricName.sagaDurationSeconds,
    Math.max(0, endedAt.getTime() - startedAt.getTime()) / 1000,
  );
}

export function recordInventoryReservation(outcome: "success" | "failure"): void {
  add(
    outcome === "success"
      ? MetricName.inventoryReservationSuccessTotal
      : MetricName.inventoryReservationFailureTotal,
  );
}

export function recordPaymentAuthorization(outcome: "success" | "failure"): void {
  add(
    outcome === "success"
      ? MetricName.paymentAuthorizationSuccessTotal
      : MetricName.paymentAuthorizationFailureTotal,
  );
}

export function recordCacheHit(): void {
  add(MetricName.cacheHitsTotal);
}

export function recordCacheMiss(): void {
  add(MetricName.cacheMissesTotal);
}

function add(name: string, attributes?: Record<string, string>): void {
  const current = meter;
  if (current === undefined) {
    return;
  }
  let counter = counters.get(name);
  if (counter === undefined) {
    counter = current.createCounter(name);
    counters.set(name, counter);
  }
  counter.add(1, attributes);
}

function record(name: string, value: number, attributes?: Record<string, string>): void {
  const current = meter;
  if (current === undefined) {
    return;
  }
  let histogram = histograms.get(name);
  if (histogram === undefined) {
    histogram = current.createHistogram(name, { unit: "s" });
    histograms.set(name, histogram);
  }
  histogram.record(value, attributes);
}

function signalUrl(endpoint: string, signal: "traces" | "metrics"): string {
  const trimmed = endpoint.replace(/\/$/, "");
  const suffix = `/v1/${signal}`;
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}
