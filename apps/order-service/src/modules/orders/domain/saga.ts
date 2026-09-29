import { AppError, ErrorCode } from "@commerce-flow/errors";

export const SagaState = {
  created: "CREATED",
  inventoryReservationPending: "INVENTORY_RESERVATION_PENDING",
  inventoryReserved: "INVENTORY_RESERVED",
  paymentPending: "PAYMENT_PENDING",
  paymentAuthorized: "PAYMENT_AUTHORIZED",
  completed: "COMPLETED",
  compensatingInventory: "COMPENSATING_INVENTORY",
  compensationCompleted: "COMPENSATION_COMPLETED",
  failed: "FAILED",
} as const;

export type SagaState = (typeof SagaState)[keyof typeof SagaState];

export const SagaSignal = {
  start: "start",
  inventoryReserved: "inventory-reserved",
  inventoryFailed: "inventory-failed",
  paymentRequested: "payment-requested",
  paymentAuthorized: "payment-authorized",
  paymentFailed: "payment-failed",
  inventoryReleased: "inventory-released",
  cancel: "cancel",
  compensate: "compensate",
  complete: "complete",
} as const;

export type SagaSignal = (typeof SagaSignal)[keyof typeof SagaSignal];

const transitions: Record<SagaState, Partial<Record<SagaSignal, SagaState>>> = {
  [SagaState.created]: {
    [SagaSignal.start]: SagaState.inventoryReservationPending,
  },
  [SagaState.inventoryReservationPending]: {
    [SagaSignal.inventoryReserved]: SagaState.inventoryReserved,
    [SagaSignal.inventoryFailed]: SagaState.failed,
    [SagaSignal.compensate]: SagaState.compensatingInventory,
    [SagaSignal.cancel]: SagaState.compensatingInventory,
  },
  [SagaState.inventoryReserved]: {
    [SagaSignal.paymentRequested]: SagaState.paymentPending,
    [SagaSignal.cancel]: SagaState.compensatingInventory,
    [SagaSignal.compensate]: SagaState.compensatingInventory,
  },
  [SagaState.paymentPending]: {
    [SagaSignal.paymentAuthorized]: SagaState.paymentAuthorized,
    [SagaSignal.paymentFailed]: SagaState.compensatingInventory,
    [SagaSignal.cancel]: SagaState.compensatingInventory,
    [SagaSignal.compensate]: SagaState.compensatingInventory,
  },
  [SagaState.paymentAuthorized]: {
    [SagaSignal.complete]: SagaState.completed,
    [SagaSignal.cancel]: SagaState.compensatingInventory,
    [SagaSignal.compensate]: SagaState.compensatingInventory,
  },
  [SagaState.completed]: {},
  [SagaState.compensatingInventory]: {
    [SagaSignal.inventoryReleased]: SagaState.compensationCompleted,
  },
  [SagaState.compensationCompleted]: {},
  [SagaState.failed]: {},
};

export function transitionSaga(state: SagaState, signal: SagaSignal): SagaState {
  const next = transitions[state][signal];
  if (next === undefined) {
    throw new AppError(ErrorCode.CONFLICT, "The order cannot accept that action", 409, {
      state,
      signal,
    });
  }
  return next;
}

export function isTerminalSaga(state: SagaState): boolean {
  return (
    state === SagaState.completed ||
    state === SagaState.compensationCompleted ||
    state === SagaState.failed
  );
}
