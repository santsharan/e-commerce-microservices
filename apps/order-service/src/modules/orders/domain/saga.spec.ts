import { AppError } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { SagaSignal, SagaState, transitionSaga } from "./saga.js";

describe("order saga", () => {
  it("moves a new order into inventory reservation", () => {
    expect(transitionSaga(SagaState.created, SagaSignal.start)).toBe(
      SagaState.inventoryReservationPending,
    );
  });

  it("keeps payment transitions in the table without starting payment", () => {
    expect(transitionSaga(SagaState.inventoryReserved, SagaSignal.paymentRequested)).toBe(
      SagaState.paymentPending,
    );
    expect(transitionSaga(SagaState.paymentPending, SagaSignal.paymentAuthorized)).toBe(
      SagaState.paymentAuthorized,
    );
    expect(transitionSaga(SagaState.paymentAuthorized, SagaSignal.complete)).toBe(
      SagaState.completed,
    );
  });

  it("rejects a signal the current state does not allow", () => {
    expect(() => transitionSaga(SagaState.created, SagaSignal.cancel)).toThrow(AppError);
    try {
      transitionSaga(SagaState.completed, SagaSignal.cancel);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
      expect((error as AppError).details).toEqual({
        state: SagaState.completed,
        signal: SagaSignal.cancel,
      });
    }
  });
});
