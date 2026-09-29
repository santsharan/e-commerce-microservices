import { describe, expect, it } from "vitest";
import { connectRedis } from "./client.js";

describe("redis client", () => {
  it("fails closed without copying the URL secret", async () => {
    const secret = "super-secret";
    const messages: string[] = [];
    try {
      await connectRedis({
        url: `redis://:${secret}@127.0.0.1:1`,
        connectTimeoutMs: 400,
        logger: {
          error(fields) {
            messages.push(fields.message);
          },
        },
      });
      expect.fail("expected the connection to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required dependency is unavailable",
      });
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(messages.join("\n")).not.toContain(secret);
    }
  });
});
