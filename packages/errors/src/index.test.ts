import { describe, expect, it } from "vitest";
import { AppError, ErrorCode, publicHttpError, redactCredentials, toPublicError } from "./index.js";

describe("public errors", () => {
  it("returns an AppError message without a stack", () => {
    const error = new AppError(ErrorCode.NOT_FOUND, "Order was not found", 404, {
      orderId: "ord-1",
    });
    const mapped = toPublicError(error, "req-1");

    expect(mapped.statusCode).toBe(404);
    expect(mapped.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Order was not found",
        requestId: "req-1",
        details: { orderId: "ord-1" },
      },
    });
    expect(JSON.stringify(mapped.body)).not.toContain("stack");
  });

  it("hides driver and stack details for unknown failures", () => {
    const failure = new Error("MongoServerError: not authorized on identity-db");
    failure.stack = "Error: MongoServerError\n    at Object.<anonymous> (/srv/app/secret.ts:10:5)";
    const mapped = toPublicError(failure, "req-2");

    expect(mapped.statusCode).toBe(500);
    expect(mapped.body.error.code).toBe("INTERNAL_ERROR");
    expect(mapped.body.error.message).toBe("An unexpected error occurred");
    const serialized = JSON.stringify(mapped.body);
    expect(serialized).not.toContain("MongoServerError");
    expect(serialized).not.toContain("secret.ts");
    expect(serialized).not.toContain("stack");
  });

  it("strips URL userinfo from driver text", () => {
    expect(redactCredentials("connect failed mongodb://user:super-secret@127.0.0.1:27017")).toBe(
      "connect failed mongodb://127.0.0.1:27017",
    );
  });

  it("maps unknown routes to a stable not-found envelope", () => {
    expect(publicHttpError(404, "req-3").body.error).toEqual({
      code: "NOT_FOUND",
      message: "The requested resource was not found",
      requestId: "req-3",
      details: {},
    });
  });
});
