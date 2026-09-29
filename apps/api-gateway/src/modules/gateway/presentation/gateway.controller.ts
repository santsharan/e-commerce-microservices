import { All, Controller, Req, Res } from "@nestjs/common";
import { API_PREFIX } from "@commerce-flow/contracts";
import { GatewayProxy } from "../application/gateway-proxy.js";

interface GatewayRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  ip?: string;
  id?: string | number;
}

interface GatewayReply {
  status(code: number): GatewayReply;
  header(name: string, value: string): GatewayReply;
  send(body: string): void;
}

@Controller()
export class GatewayController {
  public constructor(private readonly proxy: GatewayProxy) {}

  // Fastify keeps one path on a handler. routeRule decides which /api/v1 calls are served.
  @All(`${API_PREFIX.slice(1)}/*`)
  public async proxyRequest(
    @Req() request: GatewayRequest,
    @Res() reply: GatewayReply,
  ): Promise<void> {
    const path = request.url.split("?")[0] ?? request.url;
    const result = await this.proxy.handle({
      method: request.method,
      path,
      query: queryOf(request.query),
      body: request.body,
      headers: {
        authorization: headerOf(request.headers["authorization"]),
        "idempotency-key": headerOf(request.headers["idempotency-key"]),
        "if-match": headerOf(request.headers["if-match"]),
        "x-correlation-id": headerOf(request.headers["x-correlation-id"]),
        "x-request-id": request.id === undefined ? undefined : String(request.id),
      },
      ip: request.ip ?? "unknown",
    });
    reply.status(result.status);
    for (const [name, value] of Object.entries(result.headers)) {
      reply.header(name, value);
    }
    reply.send(result.body);
  }
}

function headerOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function queryOf(query: Record<string, unknown>): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      entries[key] = value;
    }
  }
  return entries;
}
