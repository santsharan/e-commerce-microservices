import { Module } from "@nestjs/common";
import { mongoInbox, mongoOutbox } from "@commerce-flow/outbox";
import { PlatformModule } from "../../bootstrap/platform.module.js";
import { ResourceRegistry } from "../../bootstrap/resources.js";
import { OrderApplication } from "./application/order-application.js";
import { MongoIdempotencyRepository } from "./infrastructure/mongo-idempotency.js";
import { MongoOrderRepository } from "./infrastructure/mongo-orders.js";
import { requireMongo, runOrderTransaction } from "./infrastructure/mongo-support.js";
import { SagaRetryTimers } from "./infrastructure/retry-timers.js";
import { OrderRuntime } from "./infrastructure/runtime.js";
import { OrdersController } from "./presentation/orders.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [OrdersController],
  providers: [
    OrderRuntime,
    SagaRetryTimers,
    {
      provide: OrderApplication,
      inject: [ResourceRegistry, SagaRetryTimers],
      useFactory: (registry: ResourceRegistry, scheduler: SagaRetryTimers): OrderApplication =>
        new OrderApplication({
          orders: new MongoOrderRepository(registry),
          idempotency: new MongoIdempotencyRepository(registry),
          transactions: { run: (work) => runOrderTransaction(registry, work) },
          outbox: mongoOutbox(() => requireMongo(registry).database),
          inbox: mongoInbox(() => requireMongo(registry).database),
          clock: { now: () => new Date() },
          scheduler,
          random: () => Math.random(),
        }),
    },
  ],
  exports: [OrderApplication, OrderRuntime],
})
export class OrdersModule {}
