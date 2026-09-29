import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadConfig } from "@commerce-flow/config";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { Logger } from "@commerce-flow/logger";
import { validatePersistenceConfig } from "@commerce-flow/mongodb";
import {
  assertDependenciesReady,
  openDependencies,
  shutdownTelemetry,
  startTelemetry,
} from "@commerce-flow/observability";
import { AppModule } from "../app.module.js";
import { OrderApplication } from "../modules/orders/application/order-application.js";
import { ensureOrderIndexes } from "../modules/orders/infrastructure/indexes.js";
import { startOrderRuntime } from "../modules/orders/infrastructure/runtime.js";
import { ResourceRegistry } from "./resources.js";
import { LOGGER } from "./tokens.js";

const bodyLimitBytes = 1_048_576;

export async function createApp(): Promise<NestFastifyApplication> {
  return NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: bodyLimitBytes,
      genReqId: () => crypto.randomUUID(),
    }),
    { logger: false },
  );
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  const config = loadConfig(process.env);
  validatePersistenceConfig(config);
  const app = await createApp();
  app.enableShutdownHooks();
  const logger = app.get<Logger>(LOGGER);
  try {
    startTelemetry(config.observability);
    const dependencies = await openDependencies(config, logger);
    app.get(ResourceRegistry).attach(dependencies);
    if (dependencies.mongo === undefined) {
      throw new AppError(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        "A required dependency is unavailable",
        503,
        { dependency: "mongodb" },
      );
    }
    await ensureOrderIndexes(dependencies.mongo.database);
    await assertDependenciesReady(dependencies);
    await startOrderRuntime({
      app,
      config,
      logger,
      orders: app.get(OrderApplication),
    });
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info({ event: "service.started", port: config.port });
    return app;
  } catch (error) {
    await shutdownTelemetry();
    await app.close();
    throw error;
  }
}
