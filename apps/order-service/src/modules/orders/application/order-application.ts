import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { EventType, type DomainEvent } from "@commerce-flow/events";
import {
  ConsumerName,
  isInboxDuplicate,
  payloadHash,
  type InboxStore,
  type OutboxWriter,
} from "@commerce-flow/outbox";
import { readFailedFact, readReleasedFact, readReservedFact } from "../domain/facts.js";
import {
  readPaymentAuthorized,
  readPaymentFailed,
  readPaymentRefunded,
} from "../domain/payment-facts.js";
import {
  DuplicateIdempotencyError,
  DuplicateOrderNumberError,
  InventoryHold,
  LineReservation,
  OrderStatus,
  idempotencyTtlSeconds,
  inventoryStatus,
  orderNumber,
  requestHash,
  requireCurrency,
  requireCustomerId,
  reservationIds,
  statusForSaga,
  type Order,
  type OrderItem,
  type OrderPayment,
  type SagaRecord,
} from "../domain/order.js";
import { priceItems, type ItemInput } from "../domain/pricing.js";
import { SagaSignal, SagaState, isTerminalSaga, transitionSaga } from "../domain/saga.js";
import {
  activeTraceId,
  recordOrderCancelled,
  recordOrderCompleted,
  recordOrderCreated,
  recordOrderFailed,
  recordSagaDuration,
  recordSagaFailure,
} from "@commerce-flow/observability";
import {
  classifySagaError,
  isRetryDue,
  retryEventType,
  scheduleSagaRetry,
  type SagaRetryPlan,
} from "../domain/saga-retry.js";
import type {
  Clock,
  IdempotencyRepository,
  OrderPage,
  OrderRepository,
  RetryScheduler,
  TransactionRunner,
} from "./ports.js";

export interface OrderDependencies {
  orders: OrderRepository;
  idempotency: IdempotencyRepository;
  transactions: TransactionRunner;
  outbox: OutboxWriter;
  inbox: InboxStore;
  clock: Clock;
  scheduler: RetryScheduler;
  random: () => number;
}

export interface CreateOrderInput {
  customerId: string;
  currency: string;
  items: ItemInput[];
  idempotencyKey: string;
  correlationId: string;
}

export interface CreateOrderResult {
  order: Order;
  replayed: boolean;
}

export class OrderApplication {
  public constructor(private readonly deps: OrderDependencies) {}

  public async create(input: CreateOrderInput): Promise<CreateOrderResult> {
    const customerId = requireCustomerId(input.customerId);
    const currency = requireCurrency(input.currency);
    const idempotencyKey = requireKey(input.idempotencyKey);
    const correlationId = requireCorrelation(input.correlationId);
    const priced = priceItems(normalizeItems(input.items));
    const hash = requestHash({ customerId, currency, items: priced.items });
    const now = this.deps.clock.now();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const order = markCreated(
        newOrder({
          customerId,
          currency,
          correlationId,
          items: priced.items.map((item) => ({
            ...item,
            reservationStatus: LineReservation.pending,
          })),
          pricing: priced.pricing,
          now,
        }),
      );
      try {
        await this.deps.transactions.run(async (session) => {
          await this.deps.idempotency.insert(
            {
              id: randomUUID(),
              customerId,
              key: idempotencyKey,
              requestHash: hash,
              orderId: order.id,
              expiresAt: new Date(now.getTime() + idempotencyTtlSeconds * 1000),
              createdAt: now,
            },
            session,
          );
          await this.deps.orders.insert(order, session);
          for (const event of creationEvents(order)) {
            await this.deps.outbox.append(event, session);
          }
        });
        recordOrderCreated();
        return { order, replayed: false };
      } catch (error) {
        if (error instanceof DuplicateOrderNumberError) {
          continue;
        }
        if (error instanceof DuplicateIdempotencyError) {
          return { order: await this.replay(customerId, idempotencyKey, hash), replayed: true };
        }
        throw error;
      }
    }
    throw conflict("The order could not be created");
  }

  public async get(id: string, actor?: OrderActor): Promise<Order> {
    const order = await this.requireOrder(id);
    assertOwner(order, actor);
    return order;
  }

  public list(customerId: string, page: number, limit: number): Promise<OrderPage> {
    return this.deps.orders.listByCustomer(requireCustomerId(customerId), page, limit);
  }

  public async cancel(id: string, version: number, actor?: OrderActor): Promise<Order> {
    const order = await this.requireOrder(id);
    assertOwner(order, actor);
    if (order.version !== version) {
      throw conflict("The order was updated by someone else");
    }
    if (
      order.saga.state === SagaState.compensatingInventory ||
      order.status === OrderStatus.cancelled
    ) {
      return order;
    }
    if (isTerminalSaga(order.saga.state)) {
      throw conflict("The order cannot be cancelled");
    }
    const next = retarget(order, transitionSaga(order.saga.state, SagaSignal.cancel), "cancel");
    const saved = await this.save(next, order.version);
    const released = await this.publishReleases(saved);
    return this.publishRefundIfNeeded(released);
  }

  public async applyReserved(event: DomainEvent<unknown>, session?: object): Promise<void> {
    const fact = readReservedFact(event);
    const order = await this.requireOrder(fact.orderId);
    const item = line(order, fact.sku);
    if (
      item.reservationStatus === LineReservation.reserved &&
      item.reservationId === fact.reservationId
    ) {
      if (order.saga.state === SagaState.inventoryReserved) {
        await this.requestPayment(order, session);
      }
      return;
    }
    if (item.quantity !== fact.quantity) {
      throw conflict("The reservation does not match the order");
    }
    const items = order.items.map((entry) =>
      entry.sku === fact.sku
        ? {
            ...entry,
            reservationId: fact.reservationId,
            reservationStatus: LineReservation.reserved,
          }
        : entry,
    );
    let next = replaceItems(order, items);
    if (
      next.saga.state === SagaState.compensatingInventory ||
      next.saga.state === SagaState.compensationCompleted
    ) {
      next = await this.save(next, order.version, session);
      const released = await this.publishReleases(next, session);
      await this.publishRefundIfNeeded(released, session);
      return;
    }
    if (next.saga.state === SagaState.inventoryReservationPending && allReserved(next.items)) {
      next = retarget(next, transitionSaga(next.saga.state, SagaSignal.inventoryReserved));
    }
    const saved = await this.save(next, order.version, session);
    if (saved.saga.state === SagaState.inventoryReserved) {
      await this.requestPayment(saved, session);
    }
  }

  public async applyFailed(event: DomainEvent<unknown>, session?: object): Promise<void> {
    const fact = readFailedFact(event);
    const order = await this.requireOrder(fact.orderId);
    const item = line(order, fact.sku);
    if (item.reservationStatus === LineReservation.failed) {
      return;
    }
    const items = order.items.map((entry) =>
      entry.sku === fact.sku ? { ...entry, reservationStatus: LineReservation.failed } : entry,
    );
    let next = replaceItems(order, items);
    const held = next.items.some((entry) => entry.reservationStatus === LineReservation.reserved);
    const waiting = next.items.some((entry) => entry.reservationStatus === LineReservation.pending);
    if (next.saga.state === SagaState.inventoryReservationPending && !waiting) {
      next = held
        ? retarget(
            next,
            transitionSaga(next.saga.state, SagaSignal.compensate),
            "failure",
            fact.reason,
          )
        : retarget(
            next,
            transitionSaga(next.saga.state, SagaSignal.inventoryFailed),
            "failure",
            fact.reason,
          );
    }
    const saved = await this.save(next, order.version, session);
    if (saved.saga.state === SagaState.compensatingInventory) {
      await this.publishReleases(saved, session);
    }
  }

  public async applyReleased(event: DomainEvent<unknown>, session?: object): Promise<void> {
    const fact = readReleasedFact(event);
    const order = await this.requireOrder(fact.orderId);
    const item = line(order, fact.sku);
    if (item.reservationId !== undefined && item.reservationId !== fact.reservationId) {
      throw conflict("The reservation does not match the order");
    }
    if (item.reservationStatus === LineReservation.released) {
      await this.finishCancellation(order, session);
      return;
    }
    const items = order.items.map((entry) =>
      entry.sku === fact.sku ? { ...entry, reservationStatus: LineReservation.released } : entry,
    );
    let next = replaceItems(order, items);
    if (
      fact.reason === "expired" &&
      (next.saga.state === SagaState.inventoryReserved ||
        next.saga.state === SagaState.inventoryReservationPending ||
        next.saga.state === SagaState.paymentPending ||
        next.saga.state === SagaState.paymentAuthorized)
    ) {
      next = retarget(
        next,
        transitionSaga(next.saga.state, SagaSignal.compensate),
        "failure",
        "expired",
      );
    }
    const waiting = next.items.some(
      (entry) =>
        entry.reservationStatus === LineReservation.pending ||
        entry.reservationStatus === LineReservation.reserved,
    );
    if (next.saga.state === SagaState.compensatingInventory && !waiting) {
      next = retarget(next, transitionSaga(next.saga.state, SagaSignal.inventoryReleased));
    }
    const saved = await this.save(next, order.version, session);
    const released =
      saved.saga.state === SagaState.compensatingInventory
        ? await this.publishReleases(saved, session)
        : saved;
    const refunded = await this.publishRefundIfNeeded(released, session);
    await this.finishCancellation(refunded, session);
  }

  public async accept(
    event: DomainEvent<unknown>,
    work: (session: object) => Promise<void>,
  ): Promise<void> {
    try {
      await this.deps.transactions.run(async (session) => {
        const claim = await this.deps.inbox.claim(
          {
            eventId: event.eventId,
            consumer: ConsumerName.order,
            payloadHash: payloadHash(event.payload),
            now: this.deps.clock.now(),
          },
          session,
        );
        if (claim === "duplicate") {
          return;
        }
        await work(session);
      });
    } catch (error) {
      if (isInboxDuplicate(error)) {
        return;
      }
      throw error;
    }
  }

  public async recover(): Promise<void> {
    const now = this.deps.clock.now();
    const orders = await this.deps.orders.listRecoverable(50, now);
    for (const order of orders) {
      await this.advance(order);
    }
  }

  public async armTimers(): Promise<void> {
    const waiting = await this.deps.orders.listWaiting(50, this.deps.clock.now());
    for (const order of waiting) {
      if (order.saga.nextAttemptAt !== undefined) {
        this.deps.scheduler.schedule(order.id, order.saga.nextAttemptAt);
      }
    }
  }

  public async resume(orderId: string): Promise<void> {
    const order = await this.deps.orders.findById(orderId);
    if (order === null || !isRetryDue(order.saga, this.deps.clock.now())) {
      return;
    }
    await this.advance(order);
  }

  public async retry(id: string, version: number, actor?: OrderActor): Promise<Order> {
    const order = await this.requireOrder(id);
    assertAdmin(actor);
    if (order.version !== version) {
      throw conflict("The order was updated by someone else");
    }
    if (isTerminalSaga(order.saga.state)) {
      throw conflict("The order cannot be retried");
    }
    const saved = await this.save(clearRetry(order), order.version);
    await this.advance(saved);
    return this.requireOrder(saved.id);
  }

  private async replay(customerId: string, key: string, hash: string): Promise<Order> {
    const record = await this.deps.idempotency.find(customerId, key);
    if (record === null || record.requestHash !== hash) {
      throw conflict("The idempotency key was used for a different request");
    }
    if (record.expiresAt <= this.deps.clock.now()) {
      throw conflict("The idempotency key has expired");
    }
    const order = await this.deps.orders.findById(record.orderId);
    if (order === null) {
      throw conflict("The idempotency key does not match an order");
    }
    return this.publishOrDefer(order);
  }

  private async publishOrDefer(order: Order): Promise<Order> {
    try {
      return await this.publishMissing(order);
    } catch (error) {
      if (classifySagaError(error) !== "conflict") {
        await this.noteFailure(order.id, error);
      }
      throw error;
    }
  }

  private async advance(order: Order): Promise<void> {
    try {
      const published = await this.publishMissing(order);
      const released =
        published.saga.state === SagaState.compensatingInventory
          ? await this.publishReleases(published)
          : published;
      const refunded = await this.publishRefundIfNeeded(released);
      await this.finishCancellation(refunded);
    } catch (error) {
      if (classifySagaError(error) === "conflict") {
        return;
      }
      await this.noteFailure(order.id, error);
    }
  }

  private async noteFailure(orderId: string, error: unknown): Promise<void> {
    const order = await this.deps.orders.findById(orderId);
    if (
      order === null ||
      isTerminalSaga(order.saga.state) ||
      !isRetryDue(order.saga, this.deps.clock.now())
    ) {
      return;
    }
    const plan = scheduleSagaRetry({
      saga: order.saga,
      error,
      now: this.deps.clock.now(),
      random: this.deps.random,
    });
    const planned = applyRetryPlan(order, plan);
    const saved = await this.persist(planned, order.version, retryEvents(planned, plan));
    if (saved.saga.nextAttemptAt !== undefined) {
      this.deps.scheduler.schedule(saved.id, saved.saga.nextAttemptAt);
    }
  }

  private async publishMissing(order: Order, session?: object): Promise<Order> {
    let current = order;
    if (!current.saga.createdPublished) {
      current = await this.persist(
        markCreated(current),
        current.version,
        creationEvents(current),
        session,
      );
    }
    if (current.saga.state === SagaState.inventoryReserved) {
      return this.requestPayment(current, session);
    }
    if (current.saga.state === SagaState.paymentPending) {
      return this.publishPaymentRequest(current, session);
    }
    if (
      current.saga.state === SagaState.paymentAuthorized ||
      current.saga.state === SagaState.completed
    ) {
      return this.finishConfirmation(current, session);
    }
    return current;
  }

  private async requestPayment(order: Order, session?: object): Promise<Order> {
    if (order.saga.state === SagaState.paymentPending) {
      return this.publishPaymentRequest(order, session);
    }
    if (order.saga.state !== SagaState.inventoryReserved) {
      return order;
    }
    const pending = markPaymentRequested(
      retarget(order, transitionSaga(order.saga.state, SagaSignal.paymentRequested)),
    );
    return this.persist(pending, order.version, [paymentCommand(pending)], session);
  }

  private async publishPaymentRequest(order: Order, session?: object): Promise<Order> {
    if (order.saga.state !== SagaState.paymentPending || order.saga.paymentRequested) {
      return order;
    }
    return this.persist(
      markPaymentRequested(order),
      order.version,
      [paymentCommand(order)],
      session,
    );
  }

  public async applyPaymentAuthorized(
    event: DomainEvent<unknown>,
    session?: object,
  ): Promise<void> {
    const fact = readPaymentAuthorized(event);
    const order = await this.requireOrder(fact.orderId);
    assertPaymentMatches(order, fact.amount, fact.currency);
    if (
      order.payment.paymentId === fact.paymentId &&
      (order.saga.state === SagaState.paymentAuthorized || order.saga.state === SagaState.completed)
    ) {
      await this.finishConfirmation(order, session);
      return;
    }
    if (order.payment.status === "refunded") {
      return;
    }
    const paid = withPayment(order, { status: "authorized", paymentId: fact.paymentId });
    if (
      paid.saga.state === SagaState.compensatingInventory ||
      paid.saga.state === SagaState.compensationCompleted
    ) {
      const saved = await this.save(paid, order.version, session);
      await this.publishRefundIfNeeded(saved, session);
      return;
    }
    if (paid.saga.state !== SagaState.paymentPending) {
      throw conflict("The order cannot accept that action");
    }
    const authorized = await this.save(
      retarget(paid, transitionSaga(paid.saga.state, SagaSignal.paymentAuthorized)),
      order.version,
      session,
    );
    await this.finishConfirmation(authorized, session);
  }

  public async applyPaymentFailed(event: DomainEvent<unknown>, session?: object): Promise<void> {
    const fact = readPaymentFailed(event);
    const order = await this.requireOrder(fact.orderId);
    if (
      order.saga.state === SagaState.failed ||
      order.saga.state === SagaState.compensatingInventory ||
      order.saga.state === SagaState.compensationCompleted
    ) {
      return;
    }
    assertPaymentMatches(order, fact.amount, fact.currency);
    if (order.saga.state !== SagaState.paymentPending) {
      throw conflict("The order cannot accept that action");
    }
    const failed = withPayment(order, { status: "failed", paymentId: fact.paymentId });
    const next = retarget(
      failed,
      transitionSaga(failed.saga.state, SagaSignal.paymentFailed),
      "failure",
      fact.reason ?? "declined",
    );
    const saved = await this.save(next, order.version, session);
    await this.publishReleases(saved, session);
  }

  public async applyPaymentRefunded(event: DomainEvent<unknown>, session?: object): Promise<void> {
    const fact = readPaymentRefunded(event);
    const order = await this.requireOrder(fact.orderId);
    if (order.payment.status === "refunded" && order.payment.paymentId === fact.paymentId) {
      return;
    }
    if (order.payment.paymentId !== undefined && order.payment.paymentId !== fact.paymentId) {
      throw conflict("The payment does not match the order");
    }
    assertPaymentMatches(order, fact.amount, fact.currency);
    await this.save(
      withPayment(order, { status: "refunded", paymentId: fact.paymentId }),
      order.version,
      session,
    );
  }

  private async finishConfirmation(order: Order, session?: object): Promise<Order> {
    let current = order;
    if (current.saga.state === SagaState.paymentAuthorized) {
      current = await this.save(
        retarget(current, transitionSaga(current.saga.state, SagaSignal.complete)),
        current.version,
        session,
      );
    }
    if (current.status !== OrderStatus.confirmed) {
      return current;
    }
    if (!current.saga.confirmedPublished) {
      current = await this.persist(
        markConfirmed(current),
        current.version,
        [
          orderEvent(current, EventType.orderConfirmed, {
            orderId: current.id,
            orderNumber: current.orderNumber,
            customerId: current.customerId,
            currency: current.currency,
            grandTotal: current.pricing.grandTotal,
            ...(current.payment.paymentId === undefined
              ? {}
              : { paymentId: current.payment.paymentId }),
          }),
        ],
        session,
      );
    }
    return this.commitInventory(current, session);
  }

  private async commitInventory(order: Order, session?: object): Promise<Order> {
    if (order.status !== OrderStatus.confirmed || order.saga.inventoryCommitted) {
      return order;
    }
    const events = order.items.flatMap((item) => {
      if (item.reservationStatus !== LineReservation.reserved || item.reservationId === undefined) {
        return [];
      }
      return [
        commandEvent(order, EventType.inventoryCommitRequested, {
          reservationId: item.reservationId,
          orderId: order.id,
          sku: item.sku,
        }),
      ];
    });
    return this.persist(markInventoryCommitted(order), order.version, events, session);
  }

  private async publishRefundIfNeeded(order: Order, session?: object): Promise<Order> {
    if (
      order.payment.status !== "authorized" ||
      order.payment.paymentId === undefined ||
      order.saga.refundRequested
    ) {
      return order;
    }
    if (
      order.saga.state !== SagaState.compensatingInventory &&
      order.saga.state !== SagaState.compensationCompleted
    ) {
      return order;
    }
    return this.persist(
      markRefundRequested(order),
      order.version,
      [
        commandEvent(order, EventType.paymentRefundRequested, {
          paymentId: order.payment.paymentId,
          orderId: order.id,
          amount: order.pricing.grandTotal,
          currency: order.currency,
        }),
      ],
      session,
    );
  }

  private async publishReleases(order: Order, session?: object): Promise<Order> {
    if (order.saga.state !== SagaState.compensatingInventory) {
      return order;
    }
    const events: DomainEvent<unknown>[] = [];
    const items = order.items.map((item) => {
      if (
        item.reservationStatus !== LineReservation.reserved ||
        item.reservationId === undefined ||
        item.releaseQueued === true
      ) {
        return item;
      }
      events.push(
        commandEvent(order, EventType.inventoryReleaseRequested, {
          reservationId: item.reservationId,
          orderId: order.id,
          sku: item.sku,
        }),
      );
      return { ...item, releaseQueued: true as const };
    });
    if (events.length === 0) {
      return order;
    }
    return this.persist(replaceItems(order, items), order.version, events, session);
  }

  private async finishCancellation(order: Order, session?: object): Promise<Order> {
    if (order.status !== OrderStatus.cancelled || order.saga.cancelledPublished) {
      return order;
    }
    return this.persist(
      markCancelled(order),
      order.version,
      [
        orderEvent(order, EventType.orderCancelled, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          reason: "cancelled",
        }),
      ],
      session,
    );
  }

  private async persist(
    order: Order,
    expectedVersion: number,
    events: readonly DomainEvent<unknown>[],
    session?: object,
  ): Promise<Order> {
    const write = async (current: object): Promise<Order> => {
      const saved = await this.save(order, expectedVersion, current);
      for (const event of events) {
        await this.deps.outbox.append(event, current);
      }
      return saved;
    };
    if (session !== undefined) {
      return write(session);
    }
    return this.deps.transactions.run(write);
  }

  private async save(order: Order, expectedVersion: number, session?: object): Promise<Order> {
    const previous = await this.deps.orders.findById(order.id, session);
    const saved = await this.deps.orders.update(
      {
        ...order,
        inventory: {
          status: inventoryStatus(order.items, order.saga.state),
          reservationIds: reservationIds(order.items),
        },
        updatedAt: this.deps.clock.now(),
      },
      expectedVersion,
      session,
    );
    if (saved === "missing") {
      throw notFound();
    }
    if (saved === "conflict") {
      throw conflict("The order was updated by someone else");
    }
    if (previous !== null) {
      recordOrderTransition(previous, saved);
    }
    return saved;
  }

  private async requireOrder(id: string): Promise<Order> {
    const order = await this.deps.orders.findById(id.trim());
    if (order === null) {
      throw notFound();
    }
    return order;
  }
}

function newOrder(input: {
  customerId: string;
  currency: string;
  correlationId: string;
  items: OrderItem[];
  pricing: Order["pricing"];
  now: Date;
}): Order {
  const id = randomUUID();
  const saga: SagaRecord = {
    sagaId: randomUUID(),
    state: transitionSaga(SagaState.created, SagaSignal.start),
    currentStep: SagaState.inventoryReservationPending,
    retryCount: 0,
    localAttempts: 0,
    topicAttempts: 0,
    dlqPublished: false,
    retryHalted: false,
    createdPublished: false,
    cancelledPublished: false,
    paymentRequested: false,
    confirmedPublished: false,
    refundRequested: false,
    inventoryCommitted: false,
  };
  return {
    id,
    orderNumber: orderNumber(),
    customerId: input.customerId,
    status: OrderStatus.pending,
    currency: input.currency,
    correlationId: input.correlationId,
    items: input.items,
    pricing: input.pricing,
    payment: { status: "pending" },
    inventory: { status: InventoryHold.pending, reservationIds: [] },
    saga,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function replaceItems(order: Order, items: OrderItem[]): Order {
  return {
    ...order,
    items,
    inventory: {
      status: inventoryStatus(items, order.saga.state),
      reservationIds: reservationIds(items),
    },
  };
}

function retarget(
  order: Order,
  state: SagaState,
  closure?: SagaRecord["closure"],
  lastError?: string,
): Order {
  const saga: SagaRecord = {
    ...order.saga,
    state,
    currentStep: state,
  };
  if (closure !== undefined) {
    saga.closure = closure;
  }
  if (lastError !== undefined) {
    saga.lastError = lastError;
  }
  return {
    ...order,
    saga,
    status: statusForSaga(state, saga.closure),
    inventory: {
      status: inventoryStatus(order.items, state),
      reservationIds: reservationIds(order.items),
    },
  };
}

function clearRetry(order: Order): Order {
  const { lastError: _lastError, nextAttemptAt: _nextAttemptAt, ...saga } = order.saga;
  return {
    ...order,
    saga: {
      ...saga,
      localAttempts: 0,
      topicAttempts: 0,
      dlqPublished: false,
      retryHalted: false,
    },
  };
}

function applyRetryPlan(order: Order, plan: SagaRetryPlan): Order {
  const { nextAttemptAt: _nextAttemptAt, ...saga } = order.saga;
  const next: SagaRecord = {
    ...saga,
    localAttempts: plan.localAttempts,
    topicAttempts: plan.topicAttempts,
    retryCount: plan.retryCount,
    lastError: plan.lastError,
    dlqPublished: plan.dlqPublished,
    retryHalted: plan.retryHalted,
  };
  if (plan.nextAttemptAt !== undefined) {
    next.nextAttemptAt = plan.nextAttemptAt;
  }
  return { ...order, saga: next };
}

function markCreated(order: Order): Order {
  return { ...order, saga: { ...order.saga, createdPublished: true } };
}

function markPaymentRequested(order: Order): Order {
  return { ...order, saga: { ...order.saga, paymentRequested: true } };
}

function markConfirmed(order: Order): Order {
  return { ...order, saga: { ...order.saga, confirmedPublished: true } };
}

function markRefundRequested(order: Order): Order {
  return { ...order, saga: { ...order.saga, refundRequested: true } };
}

function markInventoryCommitted(order: Order): Order {
  return { ...order, saga: { ...order.saga, inventoryCommitted: true } };
}

function markCancelled(order: Order): Order {
  return { ...order, saga: { ...order.saga, cancelledPublished: true } };
}

function withPayment(order: Order, payment: OrderPayment): Order {
  return { ...order, payment };
}

function assertPaymentMatches(order: Order, amount: number, currency: string): void {
  if (amount !== order.pricing.grandTotal || currency !== order.currency) {
    throw conflict("The payment does not match the order");
  }
}

function line(order: Order, sku: string): OrderItem {
  const item = order.items.find((entry) => entry.sku === sku);
  if (item === undefined) {
    throw conflict("The reservation does not match the order");
  }
  return item;
}

function allReserved(items: readonly OrderItem[]): boolean {
  return items.every((item) => item.reservationStatus === LineReservation.reserved);
}

function normalizeItems(items: readonly ItemInput[]): ItemInput[] {
  return items.map((item) => {
    const productId = item.productId.trim();
    const sku = item.sku.trim();
    const name = item.name.trim();
    if (
      productId.length === 0 ||
      productId.length > 80 ||
      !isOrderSku(sku) ||
      name.length === 0 ||
      name.length > 200
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
    }
    return { productId, sku, name, unitPrice: item.unitPrice, quantity: item.quantity };
  });
}

function isOrderSku(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(value);
}

function requireKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["Idempotency-Key"],
    });
  }
  return trimmed;
}

function requireCorrelation(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["correlationId"],
    });
  }
  return trimmed;
}

function creationEvents(order: Order): DomainEvent<unknown>[] {
  return [
    orderEvent(order, EventType.orderCreated, createdPayload(order)),
    ...order.items
      .filter((item) => item.reservationStatus === LineReservation.pending)
      .map((item) =>
        commandEvent(order, EventType.inventoryReserveRequested, {
          orderId: order.id,
          sku: item.sku,
          quantity: item.quantity,
        }),
      ),
  ];
}

function paymentCommand(order: Order): DomainEvent<unknown> {
  return commandEvent(order, EventType.paymentAuthorizationRequested, {
    orderId: order.id,
    amount: order.pricing.grandTotal,
    currency: order.currency,
  });
}

function retryEvents(order: Order, plan: SagaRetryPlan): DomainEvent<unknown>[] {
  if (plan.decision.action === "retry-topic") {
    return [
      commandEvent(order, retryEventType(plan.decision.topic), {
        orderId: order.id,
        sagaId: order.saga.sagaId,
        availableAt: order.saga.nextAttemptAt?.toISOString(),
        localAttempts: order.saga.localAttempts,
        topicAttempts: order.saga.topicAttempts,
      }),
    ];
  }
  if (plan.decision.action === "dlq") {
    return [
      commandEvent(order, EventType.sagaDeadLettered, {
        originalEvent: {
          aggregateId: order.id,
          state: order.saga.state,
          currentStep: order.saga.currentStep,
        },
        errorCode: plan.errorCode,
        errorMessage: plan.lastError,
        stack: plan.stack,
        consumer: ConsumerName.order,
        attempts: order.saga.retryCount,
        failedAt: order.updatedAt.toISOString(),
        correlationId: order.correlationId,
        orderId: order.id,
        sagaId: order.saga.sagaId,
      }),
    ];
  }
  return [];
}

function orderEvent(order: Order, eventType: EventType, payload: unknown): DomainEvent<unknown> {
  const event: DomainEvent<unknown> = {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: order.updatedAt.toISOString(),
    producer: "order-service",
    aggregateType: "order",
    aggregateId: order.id,
    correlationId: order.correlationId,
    payload,
  };
  const traceId = activeTraceId();
  if (traceId !== undefined) {
    event.traceId = traceId;
  }
  return event;
}

function recordOrderTransition(before: Order, after: Order): void {
  const finished =
    (before.status !== OrderStatus.confirmed && after.status === OrderStatus.confirmed) ||
    (before.status !== OrderStatus.failed && after.status === OrderStatus.failed) ||
    (before.status !== OrderStatus.cancelled && after.status === OrderStatus.cancelled) ||
    (!before.saga.dlqPublished && after.saga.dlqPublished);
  if (before.status !== OrderStatus.confirmed && after.status === OrderStatus.confirmed) {
    recordOrderCompleted();
  }
  if (before.status !== OrderStatus.failed && after.status === OrderStatus.failed) {
    recordOrderFailed();
    recordSagaFailure();
  }
  if (before.status !== OrderStatus.cancelled && after.status === OrderStatus.cancelled) {
    recordOrderCancelled();
  }
  if (!before.saga.dlqPublished && after.saga.dlqPublished) {
    recordSagaFailure();
  }
  if (finished) {
    recordSagaDuration(after.createdAt, after.updatedAt);
  }
}

function commandEvent(order: Order, eventType: EventType, payload: unknown): DomainEvent<unknown> {
  return orderEvent(order, eventType, payload);
}

function createdPayload(order: Order): unknown {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    currency: order.currency,
    grandTotal: order.pricing.grandTotal,
    items: order.items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      nameSnapshot: item.nameSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot,
      quantity: item.quantity,
      subtotal: item.subtotal,
    })),
  };
}

function notFound(): AppError {
  return new AppError(ErrorCode.NOT_FOUND, "Order was not found", 404, {});
}

export interface OrderActor {
  userId: string;
  roles: readonly string[];
}

function assertOwner(order: Order, actor: OrderActor | undefined): void {
  if (actor === undefined || actor.roles.includes("admin") || actor.roles.includes("support")) {
    return;
  }
  if (order.customerId !== actor.userId) {
    throw notFound();
  }
}

function assertAdmin(actor: OrderActor | undefined): void {
  if (actor === undefined || actor.roles.includes("admin")) {
    return;
  }
  throw new AppError(ErrorCode.FORBIDDEN, "Forbidden", 403, {});
}

function conflict(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message, 409, {});
}
