import { Writable } from "node:stream";
import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./index.js";

function captureLogs(): { destination: DestinationStream; read: () => string[] } {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { destination, read: () => lines };
}

describe("createLogger", () => {
  it("writes structured JSON with service, level, event, and timestamp", () => {
    const captured = captureLogs();
    const logger = createLogger({
      service: "order-service",
      level: "info",
      destination: captured.destination,
    });

    logger.info({ event: "order.created", orderId: "ord-1", durationMs: 43 });
    const line = captured.read().join("");
    const parsed = JSON.parse(line) as Record<string, unknown>;

    expect(parsed["service"]).toBe("order-service");
    expect(parsed["level"]).toBe("info");
    expect(parsed["event"]).toBe("order.created");
    expect(parsed["orderId"]).toBe("ord-1");
    expect(typeof parsed["timestamp"]).toBe("string");
  });

  it("redacts credentials and tokens", () => {
    const captured = captureLogs();
    const logger = createLogger({
      service: "identity-service",
      level: "info",
      destination: captured.destination,
    });

    logger.info({
      event: "identity.login.rejected",
      password: "hunter2",
      passwordHash: "argon-hash-secret",
      secretHash: "refresh-hash-secret",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      authorization: "Bearer secret-token",
      cardNumber: "4242424242424242",
      nested: { password: "also-secret" },
    });

    const line = captured.read().join("");
    expect(line).toContain("[Redacted]");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("argon-hash-secret");
    expect(line).not.toContain("refresh-hash-secret");
    expect(line).not.toContain("access-secret");
    expect(line).not.toContain("refresh-secret");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("4242424242424242");
    expect(line).not.toContain("also-secret");
  });
});
