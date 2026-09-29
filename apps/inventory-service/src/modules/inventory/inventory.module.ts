import { Module } from "@nestjs/common";
import { mongoInbox, mongoOutbox } from "@commerce-flow/outbox";
import { PlatformModule } from "../../bootstrap/platform.module.js";
import { ResourceRegistry } from "../../bootstrap/resources.js";
import { InventoryApplication } from "./application/inventory-application.js";
import { MongoReservationRepository } from "./infrastructure/mongo-reservations.js";
import { MongoStockRepository } from "./infrastructure/mongo-stock.js";
import { requireMongo, runInventoryTransaction } from "./infrastructure/mongo-support.js";
import { InventoryRuntime } from "./infrastructure/runtime.js";
import { InventoryController } from "./presentation/inventory.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [InventoryController],
  providers: [
    InventoryRuntime,
    {
      provide: InventoryApplication,
      inject: [ResourceRegistry],
      useFactory: (registry: ResourceRegistry): InventoryApplication =>
        new InventoryApplication({
          stock: new MongoStockRepository(registry),
          reservations: new MongoReservationRepository(registry),
          transactions: { run: (work) => runInventoryTransaction(registry, work) },
          outbox: mongoOutbox(() => requireMongo(registry).database),
          inbox: mongoInbox(() => requireMongo(registry).database),
          clock: { now: () => new Date() },
        }),
    },
  ],
  exports: [InventoryApplication, InventoryRuntime],
})
export class InventoryModule {}
