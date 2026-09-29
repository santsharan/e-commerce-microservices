import { Module } from "@nestjs/common";
import type { AppConfig } from "@commerce-flow/config";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { PlatformModule } from "../../bootstrap/platform.module.js";
import { GatewayKeys } from "../../bootstrap/gateway-keys.js";
import { ResourceRegistry } from "../../bootstrap/resources.js";
import { CONFIG } from "../../bootstrap/tokens.js";
import { GatewayProxy } from "./application/gateway-proxy.js";
import { GatewayController } from "./presentation/gateway.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [GatewayController],
  providers: [
    GatewayKeys,
    {
      provide: GatewayProxy,
      inject: [ResourceRegistry, GatewayKeys, CONFIG],
      useFactory: (
        registry: ResourceRegistry,
        keys: GatewayKeys,
        config: AppConfig,
      ): GatewayProxy =>
        new GatewayProxy({
          upstreams: config.gateway.upstreams,
          publicKeyPem: () => keys.publicKey(),
          issuer: config.auth.issuer,
          audience: config.auth.audience,
          rateLimit: {
            async increment(key, ttlSeconds) {
              const redis = registry.opened()?.redis;
              if (redis === undefined) {
                throw new AppError(
                  ErrorCode.DEPENDENCY_UNAVAILABLE,
                  "A required dependency is unavailable",
                  503,
                  { dependency: "redis" },
                );
              }
              return redis.increment(key, ttlSeconds);
            },
          },
          fetch: (url, init) => fetch(url, init),
        }),
    },
  ],
})
export class GatewayModule {}
