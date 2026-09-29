import { logEvent } from "@/lib/logger";
import { readFailure, type GatewayFailure } from "@/lib/types";

export interface GatewayResult {
  status: number;
  body: unknown;
  etag?: string;
}

export async function sendGateway(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  token?: string,
): Promise<GatewayResult> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const method = init.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${gatewayUrl()}${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (error) {
    logEvent("error", "gateway.unreachable", {
      method,
      path,
      message: error instanceof Error ? error.message : "fetch failed",
    });
    return {
      status: 503,
      body: {
        error: { code: "DEPENDENCY_UNAVAILABLE", message: "The store cannot reach the gateway" },
      },
    };
  }
  const text = await response.text();
  const body: unknown = text.length === 0 ? {} : parseJson(text);
  logEvent(response.ok ? "info" : "error", "gateway.response", {
    method,
    path,
    status: response.status,
  });
  const etag = response.headers.get("etag") ?? undefined;
  return etag === undefined
    ? { status: response.status, body }
    : { status: response.status, body, etag };
}

export function failureOf(result: GatewayResult): GatewayFailure {
  return readFailure(result.status, result.body);
}

function gatewayUrl(): string {
  return (process.env["GATEWAY_URL"] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
