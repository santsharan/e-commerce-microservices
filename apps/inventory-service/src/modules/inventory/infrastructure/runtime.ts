import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { AppConfig } from "@commerce-flow/config";
import { Topics } from "@commerce-flow/events";
import type { Logger } from "@commerce-flow/logger";
import { consumeTopic } from "@commerce-flow/kafka";
import { startOutboxLoop } from "@commerce-flow/outbox";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ResourceRegistry } from "../../../bootstrap/resources.js";
import { InventoryApplication } from "../application/inventory-application.js";
import { expirationIntervalMs } from "../domain/stock.js";
import { InventoryCommands } from "./kafka-inventory.js";

@Injectable()
export class InventoryRuntime implements OnApplicationShutdown {
  private stop: (() => Promise<void>) | undefined;

  public bind(stop: () => Promise<void>): void {
    this.stop = stop;
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stop?.();
  }
}

export async function startInventoryRuntime(input: {
  app: NestFastifyApplication;
  config: AppConfig;
  logger: Logger;
  inventory: InventoryApplication;
}): Promise<void> {
  const commands = new InventoryCommands(input.inventory, input.logger);
  const consumer = await consumeTopic({
    brokers: input.config.kafka.brokers,
    clientId: `${input.config.kafka.clientId}-commands`,
    groupId: input.config.kafka.groupId,
    topic: Topics.inventoryCommands,
    logger: input.logger,
    handle: (event) => commands.handle(event),
  });
  const expiration = setInterval(() => {
    void input.inventory.expireDue().catch((error: unknown) => {
      input.logger.error({
        event: "inventory.expiration.failed",
        message: error instanceof Error ? error.message : "expiration failed",
      });
    });
  }, expirationIntervalMs);
  expiration.unref();
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
  input.app.get(InventoryRuntime).bind(async () => {
    clearInterval(expiration);
    clearInterval(dispatcher);
    await consumer.close();
  });
}
