import { cookies } from "next/headers";
import { accessTokenIsExpired } from "@/lib/session";
import type { Order, OrderPage, Product, ProductPage, SessionUser } from "@/lib/types";
import { sendGateway } from "@/server/gateway";

const accessCookie = "cf_access";

export async function currentUser(): Promise<SessionUser | null> {
  const token = cookies().get(accessCookie)?.value;
  if (token === undefined || accessTokenIsExpired(token)) {
    return null;
  }
  const result = await sendGateway("/api/v1/users/me", {}, token);
  if (result.status !== 200 || !isUser(result.body)) {
    return null;
  }
  return result.body;
}

export async function listProducts(): Promise<Product[]> {
  const result = await sendGateway("/api/v1/products?status=active&limit=24", {}, accessToken());
  if (result.status !== 200 || !isProductPage(result.body)) {
    return [];
  }
  return result.body.items;
}

export async function getProduct(id: string): Promise<Product | null> {
  const result = await sendGateway(`/api/v1/products/${encodeURIComponent(id)}`, {}, accessToken());
  if (result.status !== 200 || !isProduct(result.body)) {
    return null;
  }
  return result.body;
}

export async function listOrders(): Promise<Order[]> {
  const result = await sendGateway("/api/v1/orders?limit=20", {}, accessToken());
  if (result.status !== 200 || !isOrderPage(result.body)) {
    return [];
  }
  return result.body.items;
}

export async function loadOrder(id: string): Promise<{ order: Order; etag: string } | null> {
  const result = await sendGateway(`/api/v1/orders/${encodeURIComponent(id)}`, {}, accessToken());
  if (result.status !== 200 || !isOrder(result.body)) {
    return null;
  }
  return { order: result.body, etag: result.etag ?? `"${result.body.version}"` };
}

function accessToken(): string | undefined {
  return cookies().get(accessCookie)?.value;
}

function isUser(value: unknown): value is SessionUser {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["email"] === "string" &&
    Array.isArray(value["roles"])
  );
}

function isProduct(value: unknown): value is Product {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    Array.isArray(value["variants"])
  );
}

function isProductPage(value: unknown): value is ProductPage {
  return isRecord(value) && Array.isArray(value["items"]);
}

function isOrder(value: unknown): value is Order {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["status"] === "string" &&
    isRecord(value["payment"]) &&
    isRecord(value["saga"]) &&
    isRecord(value["pricing"]) &&
    Array.isArray(value["items"])
  );
}

function isOrderPage(value: unknown): value is OrderPage {
  return isRecord(value) && Array.isArray(value["items"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
