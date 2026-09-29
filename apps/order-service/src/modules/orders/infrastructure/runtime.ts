import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { AppConfig } from "@commerce-flow/config";
import { Topics } from "@commerce-flow/events";
import { consumeTopic } from "@commerce-flow/kafka";
import type { Logger } from "@commerce-flow/logger";
import { startOutboxLoop } from "@commerce-flow/outbox";
import { OrderApplication } from "../application/order-application.js";
import { orderRecoveryIntervalMs } from "../domain/order.js";
import { OrderFacts } from "./kafka-orders.js";
import { SagaRetryTimers } from "./retry-timers.js";
import { ResourceRegistry } from "../../../bootstrap/resources.js";

@Injectable()
export class OrderRuntime implements OnApplicationShutdown {
  private stop: (() => Promise<void>) | undefined;

  public bind(stop: () => Promise<void>): void {
    this.stop = stop;
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stop?.();
  }
}

export async function startOrderRuntime(input: {
  app: NestFastifyApplication;
  config: AppConfig;
  logger: Logger;
  orders: OrderApplication;
}): Promise<void> {
  const facts = new OrderFacts(input.orders);
  const inventory = await consumeTopic({
    brokers: input.config.kafka.brokers,
    clientId: `${input.config.kafka.clientId}-facts`,
    groupId: input.config.kafka.groupId,
    topic: Topics.inventory,
    logger: input.logger,
    handle: (event) => facts.handle(event),
  });
  const payments = await consumeTopic({
    brokers: input.config.kafka.brokers,
    clientId: `${input.config.kafka.clientId}-payments`,
    groupId: `${input.config.kafka.groupId}-payments`,
    topic: Topics.payments,
    logger: input.logger,
    handle: (event) => facts.handle(event),
  });
  const retries = await Promise.all(
    (
      [
        [Topics.ordersRetry1m, "retry-1m"],
        [Topics.ordersRetry5m, "retry-5m"],
        [Topics.ordersRetry30m, "retry-30m"],
      ] as const
    ).map(([topic, suffix]) =>
      consumeTopic({
        brokers: input.config.kafka.brokers,
        clientId: `${input.config.kafka.clientId}-${suffix}`,
        groupId: `${input.config.kafka.groupId}-${suffix}`,
        topic,
        logger: input.logger,
        handle: (event) => facts.handle(event),
      }),
    ),
  );
  const timers = input.app.get(SagaRetryTimers);
  timers.bind((orderId) => input.orders.resume(orderId));
  await input.orders.recover();
  await input.orders.armTimers();
  const timer = setInterval(() => {
    void input.orders.recover().catch((error: unknown) => {
      input.logger.error({
        event: "order.recovery.failed",
        message: error instanceof Error ? error.message : "recovery failed",
      });
    });
  }, orderRecoveryIntervalMs);
  timer.unref();
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
  input.app.get(OrderRuntime).bind(async () => {
    clearInterval(timer);
    clearInterval(dispatcher);
    timers.stop();
    await inventory.close();
    await payments.close();
    await Promise.all(retries.map((consumer) => consumer.close()));
  });
}
