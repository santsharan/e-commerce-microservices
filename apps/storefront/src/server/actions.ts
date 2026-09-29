"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { CartLine } from "@/lib/cart";
import { accessTokenIsExpired } from "@/lib/session";
import type { Order } from "@/lib/types";
import { failureOf, sendGateway } from "@/server/gateway";

const accessCookie = "cf_access";
const refreshCookie = "cf_refresh";

export interface FormState {
  error?: string;
  expired?: boolean;
}

export async function registerAction(_state: FormState, formData: FormData): Promise<FormState> {
  return signIn("/api/v1/users/register", formData);
}

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  return signIn("/api/v1/users/login", formData);
}

export async function expireSession(): Promise<boolean> {
  const access = cookies().get(accessCookie)?.value;
  if (access !== undefined && !accessTokenIsExpired(access)) {
    const result = await sendGateway("/api/v1/users/me", {}, access);
    if (result.status === 200) {
      return false;
    }
  }
  clearSession();
  return true;
}

export async function logoutAction(): Promise<void> {
  const refresh = cookies().get(refreshCookie)?.value;
  const access = cookies().get(accessCookie)?.value;
  if (refresh !== undefined) {
    await sendGateway(
      "/api/v1/users/logout",
      { method: "POST", body: { refreshToken: refresh } },
      access,
    );
  }
  clearSession();
  redirect("/login");
}

export async function getOrder(
  id: string,
): Promise<{ order: Order; etag: string } | "expired" | null> {
  const result = await sendGateway(
    `/api/v1/orders/${encodeURIComponent(id)}`,
    {},
    cookies().get(accessCookie)?.value,
  );
  if (result.status === 401) {
    clearSession();
    return "expired";
  }
  if (result.status !== 200 || !isOrder(result.body)) {
    return null;
  }
  return { order: result.body, etag: result.etag ?? `"${result.body.version}"` };
}

export async function placeOrder(
  lines: CartLine[],
  idempotencyKey: string,
): Promise<{ id: string } | FormState> {
  const currency = lines[0]?.currency;
  if (currency === undefined || lines.some((line) => line.currency !== currency)) {
    return { error: "The cart must use one currency." };
  }
  const result = await sendGateway(
    "/api/v1/orders",
    {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey || randomUUID() },
      body: {
        currency,
        items: lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        })),
      },
    },
    cookies().get(accessCookie)?.value,
  );
  if (result.status === 401) {
    clearSession();
    return { expired: true, error: "Your session expired. Log in again." };
  }
  if ((result.status !== 201 && result.status !== 200) || !isOrder(result.body)) {
    return { error: failureOf(result).message };
  }
  return { id: result.body.id };
}

export async function cancelOrder(id: string, etag: string): Promise<FormState> {
  const result = await sendGateway(
    `/api/v1/orders/${encodeURIComponent(id)}/cancel`,
    { method: "POST", headers: { "if-match": etag } },
    cookies().get(accessCookie)?.value,
  );
  if (result.status === 401) {
    clearSession();
    return { expired: true, error: "Your session expired. Log in again." };
  }
  if (result.status >= 400) {
    return { error: failureOf(result).message };
  }
  return {};
}

async function signIn(path: string, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await sendGateway(path, { method: "POST", body: { email, password } });
  if (!isSession(result.body)) {
    return { error: failureOf(result).message };
  }
  saveSession(result.body.accessToken, result.body.refreshToken, result.body.expiresIn);
  redirect("/");
}

function saveSession(access: string, refresh: string, expiresIn: number): void {
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  const accessMaxAge = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 15 * 60;
  cookies().set(accessCookie, access, { ...common, maxAge: accessMaxAge });
  cookies().set(refreshCookie, refresh, { ...common, maxAge: 60 * 60 * 24 * 7 });
}

function clearSession(): void {
  cookies().delete(accessCookie);
  cookies().delete(refreshCookie);
}

function isSession(
  value: unknown,
): value is { accessToken: string; refreshToken: string; expiresIn: number } {
  return (
    isRecord(value) &&
    typeof value["accessToken"] === "string" &&
    typeof value["refreshToken"] === "string" &&
    typeof value["expiresIn"] === "number"
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
