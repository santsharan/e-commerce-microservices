import { Module } from "@nestjs/common";
import type { Logger } from "@commerce-flow/logger";
import { PlatformModule } from "../../bootstrap/platform.module.js";
import { ResourceRegistry } from "../../bootstrap/resources.js";
import { LOGGER } from "../../bootstrap/tokens.js";
import { CatalogApplication } from "./application/catalog-application.js";
import { MongoCategoryRepository } from "./infrastructure/mongo-categories.js";
import { MongoProductRepository } from "./infrastructure/mongo-products.js";
import { RedisCatalogCache } from "./infrastructure/redis-catalog-cache.js";
import { CategoriesController } from "./presentation/categories.controller.js";
import { ProductsController } from "./presentation/products.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [CategoriesController, ProductsController],
  providers: [
    {
      provide: CatalogApplication,
      inject: [ResourceRegistry, LOGGER],
      useFactory: (registry: ResourceRegistry, logger: Logger): CatalogApplication =>
        new CatalogApplication({
          categories: new MongoCategoryRepository(registry),
          products: new MongoProductRepository(registry),
          cache: new RedisCatalogCache(registry, logger),
          clock: { now: () => new Date() },
        }),
    },
  ],
})
export class CatalogModule {}
