import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { AppConfig } from "@commerce-flow/config";
import { Topics } from "@commerce-flow/events";
import { consumeTopic } from "@commerce-flow/kafka";
import { startOutboxLoop } from "@commerce-flow/outbox";
import type { Logger } from "@commerce-flow/logger";
import { PaymentApplication } from "../application/payment-application.js";
import { PaymentCommands } from "./kafka-payments.js";
import { ResourceRegistry } from "../../../bootstrap/resources.js";

@Injectable()
export class PaymentRuntime implements OnApplicationShutdown {
  private stop: (() => Promise<void>) | undefined;

  public bind(stop: () => Promise<void>): void {
    this.stop = stop;
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stop?.();
  }
}

export async function startPaymentRuntime(input: {
  app: NestFastifyApplication;
  config: AppConfig;
  logger: Logger;
  payments: PaymentApplication;
}): Promise<void> {
  const commands = new PaymentCommands(input.payments, input.logger);
  const consumer = await consumeTopic({
    brokers: input.config.kafka.brokers,
    clientId: `${input.config.kafka.clientId}-commands`,
    groupId: input.config.kafka.groupId,
    topic: Topics.paymentCommands,
    logger: input.logger,
    handle: (event) => commands.handle(event),
  });
  const dispatcher = startOutboxLoop({
    logger: input.logger,
    current: () => {
      const opened = input.app.get(ResourceRegistry).opened();
      const mongo = opened?.mongo;
      const kafka = opened?.kafka;
      if (mongo === undefined || kafka === undefined) {
        return undefined;
      }
      return { database: mongo.database, publish: (event) => kafka.publish(event) };
    },
  });
  input.app.get(PaymentRuntime).bind(async () => {
    clearInterval(dispatcher);
    await consumer.close();
  });
}
