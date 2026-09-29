import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import type { Logger } from "@commerce-flow/logger";
import { InventoryApplication } from "../application/inventory-application.js";
import { readReleaseCommand, readReserveCommand } from "../domain/commands.js";

export class InventoryCommands {
  public constructor(
    private readonly inventory: InventoryApplication,
    private readonly logger: Logger,
  ) {}

  public async handle(event: DomainEvent<unknown>): Promise<void> {
    try {
      if (event.eventType === EventType.inventoryReserveRequested) {
        const command = readReserveCommand(event);
        let rejected: AppError | undefined;
        await this.inventory.consume(event, async (session) => {
          const result = await this.inventory.reserveRecorded(command, session);
          if ("error" in result) {
            rejected = result.error;
          }
        });
        if (rejected !== undefined && rejected.code !== ErrorCode.DEPENDENCY_UNAVAILABLE) {
          this.logger.warn({
            event: "inventory.command.rejected",
            code: rejected.code,
            message: rejected.message,
          });
        }
        if (rejected?.code === ErrorCode.DEPENDENCY_UNAVAILABLE) {
          throw rejected;
        }
        return;
      }
      if (event.eventType === EventType.inventoryReleaseRequested) {
        await this.inventory.consume(event, async (session) => {
          await this.inventory.release(readReleaseCommand(event), session);
        });
        return;
      }
      if (event.eventType === EventType.inventoryCommitRequested) {
        await this.inventory.consume(event, async (session) => {
          await this.inventory.commit(readReleaseCommand(event), session);
        });
        return;
      }
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Unsupported inventory command", 400, {
        eventType: event.eventType,
      });
    } catch (error) {
      if (error instanceof AppError && error.code !== ErrorCode.DEPENDENCY_UNAVAILABLE) {
        this.logger.warn({
          event: "inventory.command.rejected",
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }
  }
}
