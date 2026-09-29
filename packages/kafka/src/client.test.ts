import { describe, expect, it } from "vitest";
import { connectKafka } from "./client.js";

describe("kafka client", () => {
  it("fails closed without copying broker credentials from the driver text", async () => {
    const secret = "super-secret";
    const messages: string[] = [];
    try {
      await connectKafka({
        brokers: [`user:${secret}@127.0.0.1:1`],
        clientId: "commerce-flow-test",
        connectionTimeoutMs: 400,
        retries: 0,
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
