import { Module } from "@nestjs/common";
import type { AppConfig } from "@commerce-flow/config";
import { PlatformModule } from "../../bootstrap/platform.module.js";
import { ResourceRegistry } from "../../bootstrap/resources.js";
import { CONFIG } from "../../bootstrap/tokens.js";
import { IdentityApplication } from "./application/identity-application.js";
import { Argon2PasswordHasher } from "./infrastructure/argon2-password-hasher.js";
import { JwtAccessTokens } from "./infrastructure/jwt-access-tokens.js";
import { IdentityKeys } from "./infrastructure/jwt-keys.js";
import { MongoAuditLog } from "./infrastructure/mongo-audit.js";
import { MongoRefreshTokenRepository } from "./infrastructure/mongo-refresh-tokens.js";
import { MongoUserRepository } from "./infrastructure/mongo-users.js";
import { UsersController } from "./presentation/users.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [UsersController],
  providers: [
    IdentityKeys,
    {
      provide: IdentityApplication,
      inject: [ResourceRegistry, IdentityKeys, CONFIG],
      useFactory: (
        registry: ResourceRegistry,
        keys: IdentityKeys,
        config: AppConfig,
      ): IdentityApplication =>
        new IdentityApplication({
          users: new MongoUserRepository(registry),
          refreshTokens: new MongoRefreshTokenRepository(registry),
          audit: new MongoAuditLog(registry),
          passwords: new Argon2PasswordHasher(),
          accessTokens: new JwtAccessTokens(keys, config.auth.issuer, config.auth.audience),
          clock: { now: () => new Date() },
        }),
    },
  ],
  exports: [IdentityKeys],
})
export class IdentityModule {}
