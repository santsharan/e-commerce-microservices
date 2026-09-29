import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import type { Logger } from "@commerce-flow/logger";
import { PaymentApplication } from "../application/payment-application.js";
import { readAuthorizationCommand, readRefundCommand } from "../domain/commands.js";

export class PaymentCommands {
  public constructor(
    private readonly payments: PaymentApplication,
    private readonly logger: Logger,
  ) {}

  public async handle(event: DomainEvent<unknown>): Promise<void> {
    try {
      if (event.eventType === EventType.paymentAuthorizationRequested) {
        const command = readAuthorizationCommand(event);
        await this.payments.consume(event, async (session) => {
          await this.payments.authorize(command, session);
        });
        return;
      }
      if (event.eventType === EventType.paymentRefundRequested) {
        const command = readRefundCommand(event);
        await this.payments.consume(event, async (session) => {
          await this.payments.refund(command, session);
        });
        return;
      }
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Unsupported payment command", 400, {});
    } catch (error) {
      if (error instanceof AppError && error.code !== ErrorCode.DEPENDENCY_UNAVAILABLE) {
        this.logger.warn({
          event: "payment.command.rejected",
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }
  }
}
