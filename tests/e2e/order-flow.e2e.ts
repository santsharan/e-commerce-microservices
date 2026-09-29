import { Kafka } from "kafkajs";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultPorts } from "@commerce-flow/config";
import { PaymentApplication } from "../../apps/payment-service/src/modules/payments/application/payment-application.js";
import { PaymentFailureMode } from "../../apps/payment-service/src/modules/payments/domain/payment.js";
import { startStack, type RunningStack } from "./stack.js";

const password = "correct-horse-battery";

describe("order flow", () => {
  let stack: RunningStack;

  beforeAll(async () => {
    stack = await startStack();
  }, 600_000);

  afterAll(async () => {
    await stack?.stop();
  }, 60_000);

  it("registers, reads the catalog, and confirms one order", async () => {
    const sku = skuOf("ok");
    const product = await seedProduct(sku);
    await seedStock(sku, 5);
    const access = await register(`ada-${Date.now()}@example.com`);
    const listed = await api(
      defaultPorts["api-gateway"],
      "GET",
      `/api/v1/products/${product.id}`,
      undefined,
      {
        authorization: `Bearer ${access}`,
      },
    );
    expect(listed.status).toBe(200);

    const created = await placeOrder(access, product.id, sku, "idem-ok");
    const again = await placeOrder(access, product.id, sku, "idem-ok");
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ id: created.json.id });

    const confirmed = await waitForOrder(access, String(created.json.id), "confirmed", "COMPLETED");
    expect(confirmed.customerId).toBeDefined();
    const stock = await waitFor(async () => {
      const response = await api(
        defaultPorts["inventory-service"],
        "GET",
        `/api/v1/inventory/${sku}`,
      );
      if (response.json.available === 3 && response.json.reserved === 0) {
        return response.json;
      }
      return undefined;
    });
    expect(stock).toMatchObject({ available: 3, reserved: 0 });
    await waitForOutbox(String(created.json.id));
  });

  it("releases stock when payment is declined", async () => {
    stack.payment.get(PaymentApplication).setFailureMode(PaymentFailureMode.decline);
    const sku = skuOf("no");
    await seedStock(sku, 4);
    const access = await register(`bea-${Date.now()}@example.com`);
    const created = await placeOrder(access, "product-decline", sku, "idem-no");
    const failed = await waitForOrder(
      access,
      String(created.json.id),
      "failed",
      "COMPENSATION_COMPLETED",
    );
    expect(failed.status).toBe("failed");
    const stock = await api(defaultPorts["inventory-service"], "GET", `/api/v1/inventory/${sku}`);
    expect(stock.json).toMatchObject({ available: 4, reserved: 0 });
  });

  it("applies one reserve when the same Kafka command is delivered twice", async () => {
    const sku = skuOf("dup");
    await seedStock(sku, 5);
    const event = {
      eventId: `dup-${sku}`,
      eventType: "inventory.reserve.requested",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: "e2e",
      aggregateType: "order",
      aggregateId: `order-${sku}`,
      correlationId: "corr-dup",
      payload: { orderId: `order-${sku}`, sku, quantity: 1 },
    };
    const kafka = new Kafka({ clientId: "e2e-dup", brokers: [stack.brokers] });
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: "commerce.inventory.commands.v1",
      messages: [
        { key: event.aggregateId, value: JSON.stringify(event) },
        { key: event.aggregateId, value: JSON.stringify(event) },
      ],
    });
    await producer.disconnect();
    const stock = await waitFor(async () => {
      const response = await api(
        defaultPorts["inventory-service"],
        "GET",
        `/api/v1/inventory/${sku}`,
      );
      if (response.json.available === 4 && response.json.reserved === 1) {
        return response.json;
      }
      return undefined;
    });
    await delay(1000);
    const after = await api(defaultPorts["inventory-service"], "GET", `/api/v1/inventory/${sku}`);
    expect(after.json).toEqual(stock);
  });
});

async function seedProduct(sku: string): Promise<{ id: string }> {
  const category = await api(defaultPorts["catalog-service"], "POST", "/api/v1/categories", {
    name: `Hats ${sku}`,
  });
  expect(category.status).toBe(201);
  const product = await api(defaultPorts["catalog-service"], "POST", "/api/v1/products", {
    name: `Hat ${sku}`,
    status: "active",
    categoryId: category.json.id,
    variants: [{ sku, name: "Default", price: { amount: 2500, currency: "USD" } }],
  });
  expect(product.status).toBe(201);
  return { id: String(product.json.id) };
}

async function seedStock(sku: string, quantity: number): Promise<void> {
  const created = await api(defaultPorts["inventory-service"], "POST", "/api/v1/inventory", {
    sku,
    quantity,
  });
  expect(created.status).toBe(201);
}

async function register(email: string): Promise<string> {
  const response = await api(defaultPorts["api-gateway"], "POST", "/api/v1/users/register", {
    email,
    password,
  });
  expect(response.status).toBe(201);
  return String(response.json.accessToken);
}

async function placeOrder(
  access: string,
  productId: string,
  sku: string,
  idempotencyKey: string,
): Promise<{ status: number; json: { id: string } }> {
  const response = await api(
    defaultPorts["api-gateway"],
    "POST",
    "/api/v1/orders",
    {
      currency: "USD",
      items: [{ productId, sku, name: "Hat", unitPrice: 2500, quantity: 2 }],
    },
    { authorization: `Bearer ${access}`, "idempotency-key": idempotencyKey },
  );
  expect([200, 201]).toContain(response.status);
  return { status: response.status, json: response.json as { id: string } };
}

async function waitForOrder(
  access: string,
  id: string,
  status: string,
  saga: string,
): Promise<{ status: string; customerId: string; saga: { state: string } }> {
  return waitFor(async () => {
    const response = await api(
      defaultPorts["api-gateway"],
      "GET",
      `/api/v1/orders/${id}`,
      undefined,
      {
        authorization: `Bearer ${access}`,
      },
    );
    const order = response.json as { status: string; customerId: string; saga: { state: string } };
    if (order.status === status && order.saga.state === saga) {
      return order;
    }
    if (status !== "failed" && order.status === "failed") {
      throw new Error(`order ${id} failed: ${JSON.stringify(order)}`);
    }
    return undefined;
  });
}

async function waitForOutbox(orderId: string): Promise<void> {
  const client = new MongoClient(stackUri(), { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  try {
    await waitFor(async () => {
      const pending = await client
        .db("order-db")
        .collection("outbox_events")
        .countDocuments({ aggregateId: orderId, status: "pending" });
      const published = await client
        .db("order-db")
        .collection("outbox_events")
        .countDocuments({ aggregateId: orderId, status: "published" });
      return pending === 0 && published > 0 ? true : undefined;
    });
  } finally {
    await client.close();
  }
}

function stackUri(): string {
  const uri = process.env["MONGO_URI"];
  if (uri === undefined) {
    throw new Error("MONGO_URI is missing");
  }
  return uri;
}

async function api(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = (text.length === 0 ? {} : JSON.parse(text)) as Json;
  if (response.status >= 500) {
    throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  }
  return { status: response.status, json };
}

async function waitFor<T>(load: () => Promise<T | undefined>): Promise<T> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < 25_000) {
    last = await load();
    if (last !== undefined) {
      return last;
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for the order flow: ${JSON.stringify(last)}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function skuOf(label: string): string {
  return `E2E${label}${Date.now().toString(36).toUpperCase()}`.slice(0, 32);
}

interface Json {
  id?: string;
  status?: string;
  customerId?: string;
  accessToken?: string;
  available?: number;
  reserved?: number;
  saga?: { state?: string };
}
