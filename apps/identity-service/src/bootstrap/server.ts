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
import { ensureIdentityIndexes } from "../modules/identity/infrastructure/indexes.js";
import { IdentityKeys, loadIdentityKeys } from "../modules/identity/infrastructure/jwt-keys.js";
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
    app.get(IdentityKeys).attach(await loadIdentityKeys(config.auth));
    if (dependencies.mongo === undefined) {
      throw new AppError(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        "A required dependency is unavailable",
        503,
        { dependency: "mongodb" },
      );
    }
    await ensureIdentityIndexes(dependencies.mongo.database);
    await assertDependenciesReady(dependencies);
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info({ event: "service.started", port: config.port });
    return app;
  } catch (error) {
    await shutdownTelemetry();
    await app.close();
    throw error;
  }
}
