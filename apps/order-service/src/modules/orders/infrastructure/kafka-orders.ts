import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import { OrderApplication } from "../application/order-application.js";

export class OrderFacts {
  public constructor(private readonly orders: OrderApplication) {}

  public async handle(event: DomainEvent<unknown>): Promise<void> {
    try {
      if (
        event.eventType === EventType.sagaRetry1m ||
        event.eventType === EventType.sagaRetry5m ||
        event.eventType === EventType.sagaRetry30m
      ) {
        await this.orders.resume(retryOrderId(event));
        return;
      }
      await this.orders.accept(event, async (session) => {
        if (event.eventType === EventType.inventoryReserved) {
          await this.orders.applyReserved(event, session);
          return;
        }
        if (event.eventType === EventType.inventoryReservationFailed) {
          await this.orders.applyFailed(event, session);
          return;
        }
        if (event.eventType === EventType.inventoryReleased) {
          await this.orders.applyReleased(event, session);
          return;
        }
        if (event.eventType === EventType.paymentAuthorized) {
          await this.orders.applyPaymentAuthorized(event, session);
          return;
        }
        if (event.eventType === EventType.paymentAuthorizationFailed) {
          await this.orders.applyPaymentFailed(event, session);
          return;
        }
        if (event.eventType === EventType.paymentRefunded) {
          await this.orders.applyPaymentRefunded(event, session);
          return;
        }
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Unsupported event", 400, {});
      });
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Order was not found", 400, {});
      }
      throw error;
    }
  }
}

function retryOrderId(event: DomainEvent<unknown>): string {
  const payload = event.payload;
  const orderId =
    typeof payload === "object" && payload !== null && "orderId" in payload
      ? payload.orderId
      : undefined;
  if (typeof orderId !== "string" || orderId !== event.aggregateId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {});
  }
  return orderId;
}
