import { describe, expect, it } from "vitest";
import { connectMongo } from "./client.js";

describe("mongodb client", () => {
  it("fails closed without copying the URI secret", async () => {
    const secret = "super-secret";
    const messages: string[] = [];
    try {
      await connectMongo({
        uri: `mongodb://user:${secret}@127.0.0.1:1/?replicaSet=rs0`,
        database: "identity-db",
        serverSelectionTimeoutMs: 400,
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
