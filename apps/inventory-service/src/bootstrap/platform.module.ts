import { Module } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@commerce-flow/config";
import { createLogger, type Logger } from "@commerce-flow/logger";
import { validatePersistenceConfig } from "@commerce-flow/mongodb";
import { ResourceRegistry } from "./resources.js";
import { CONFIG, LOGGER } from "./tokens.js";

@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): AppConfig => {
        const config = loadConfig(process.env);
        validatePersistenceConfig(config);
        return config;
      },
    },
    {
      provide: LOGGER,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Logger =>
        createLogger({
          service: config.observability.serviceName,
          level: config.logLevel,
        }),
    },
    ResourceRegistry,
  ],
  exports: [CONFIG, LOGGER, ResourceRegistry],
})
export class PlatformModule {}
