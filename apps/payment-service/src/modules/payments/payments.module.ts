import { Module } from "@nestjs/common";
import { mongoInbox, mongoOutbox } from "@commerce-flow/outbox";
import { PlatformModule } from "../../bootstrap/platform.module.js";
import { ResourceRegistry } from "../../bootstrap/resources.js";
import { PaymentApplication } from "./application/payment-application.js";
import { readFailureMode } from "./domain/payment.js";
import { MongoPaymentRepository } from "./infrastructure/mongo-payments.js";
import { requireMongo, runPaymentTransaction } from "./infrastructure/mongo-support.js";
import { PaymentRuntime } from "./infrastructure/runtime.js";
import { PaymentsController } from "./presentation/payments.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [PaymentsController],
  providers: [
    PaymentRuntime,
    {
      provide: PaymentApplication,
      inject: [ResourceRegistry],
      useFactory: (registry: ResourceRegistry): PaymentApplication =>
        new PaymentApplication({
          payments: new MongoPaymentRepository(registry),
          outbox: mongoOutbox(() => requireMongo(registry).database),
          inbox: mongoInbox(() => requireMongo(registry).database),
          transactions: { run: (work) => runPaymentTransaction(registry, work) },
          clock: { now: () => new Date() },
          failureMode: readFailureMode(process.env),
        }),
    },
  ],
  exports: [PaymentApplication, PaymentRuntime],
})
export class PaymentsModule {}
