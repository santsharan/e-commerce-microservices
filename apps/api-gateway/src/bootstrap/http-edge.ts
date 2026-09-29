import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { corsHeaders, securityHeaders } from "../modules/gateway/domain/http-edge.js";

export function applyGatewayHttp(
  app: NestFastifyApplication,
  input: { nodeEnv: string; corsOrigins: readonly string[] },
): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (request, reply, done) => {
    for (const [name, value] of Object.entries(securityHeaders(input.nodeEnv))) {
      reply.header(name, value);
    }
    const origin = request.headers.origin;
    const cors = corsHeaders(typeof origin === "string" ? origin : undefined, input.corsOrigins);
    if (cors !== undefined) {
      for (const [name, value] of Object.entries(cors)) {
        reply.header(name, value);
      }
    }
    if (request.method === "OPTIONS" && request.url.startsWith("/api/")) {
      reply.status(204).send();
      return;
    }
    done();
  });
}
