import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadConfig } from "@commerce-flow/config";
import type { Logger } from "@commerce-flow/logger";
import { validatePersistenceConfig } from "@commerce-flow/mongodb";
import {
  assertDependenciesReady,
  openDependencies,
  shutdownTelemetry,
  startTelemetry,
} from "@commerce-flow/observability";
import { AppModule } from "../app.module.js";
import { applyGatewayHttp } from "./http-edge.js";
import { GatewayKeys, loadGatewayPublicKey } from "./gateway-keys.js";
import { ResourceRegistry } from "./resources.js";
import { LOGGER } from "./tokens.js";

const bodyLimitBytes = 1_048_576;

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: bodyLimitBytes,
      genReqId: () => crypto.randomUUID(),
    }),
    { logger: false },
  );
  const config = loadConfig(process.env);
  applyGatewayHttp(app, { nodeEnv: config.nodeEnv, corsOrigins: config.gateway.corsOrigins });
  return app;
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
    app.get(GatewayKeys).attach(await loadGatewayPublicKey(config.auth.publicKeyPath));
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
