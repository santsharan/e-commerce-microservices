import { AppError, ErrorCode } from "@commerce-flow/errors";
import { verifyAccessToken, type AccessTokenClaims } from "@commerce-flow/auth";
import { allows, routeRule } from "../domain/route-rule.js";
import { bindCustomer } from "../domain/customer-binding.js";
import { upstreamFor, type Upstreams } from "../domain/upstreams.js";
import { consumeLoginBudget, type RateCounter } from "./login-rate-limit.js";

const proxyTimeoutMs = 5_000;

export interface ProxyRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
  ip: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface UpstreamResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface GatewayProxyDependencies {
  upstreams: Upstreams;
  publicKeyPem: () => string;
  issuer: string;
  audience: string;
  rateLimit: RateCounter;
  fetch: (url: string, init: RequestInit) => Promise<UpstreamResponse>;
}

export class GatewayProxy {
  public constructor(private readonly deps: GatewayProxyDependencies) {}

  public async handle(request: ProxyRequest): Promise<ProxyResponse> {
    const path = request.path.split("?")[0] ?? request.path;
    const rule = routeRule(request.method, path);
    if (rule === undefined) {
      throw new AppError(ErrorCode.NOT_FOUND, "Not found", 404, {});
    }
    await consumeLoginBudget(this.deps.rateLimit, request.method, path, request.ip);
    const claims =
      rule.kind === "public"
        ? undefined
        : await this.authenticate(request.headers["authorization"]);
    if (claims !== undefined && !allows(rule, claims.roles, claims.permissions)) {
      throw new AppError(ErrorCode.FORBIDDEN, "Forbidden", 403, {});
    }
    const bound =
      claims === undefined
        ? { body: request.body, query: request.query }
        : bindCustomer({
            method: request.method,
            path,
            claims,
            body: request.body,
            query: request.query,
          });
    return this.forward(request, path, bound.body, bound.query, claims);
  }

  private async authenticate(header: string | undefined): Promise<AccessTokenClaims> {
    const token = bearer(header);
    if (token === undefined) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Authentication is required", 401, {});
    }
    return verifyAccessToken(token, {
      publicKeyPem: this.deps.publicKeyPem(),
      issuer: this.deps.issuer,
      audience: this.deps.audience,
    });
  }

  private async forward(
    request: ProxyRequest,
    path: string,
    body: unknown,
    query: Record<string, string>,
    claims: AccessTokenClaims | undefined,
  ): Promise<ProxyResponse> {
    const base = upstreamFor(path, this.deps.upstreams);
    if (base === undefined) {
      throw new AppError(ErrorCode.NOT_FOUND, "Not found", 404, {});
    }
    const url = new URL(path, `${base}/`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const headers = forwardedHeaders(request, claims, base === this.deps.upstreams.identity);
    const init: RequestInit = {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(proxyTimeoutMs),
    };
    if (request.method !== "GET" && request.method !== "HEAD" && body !== undefined) {
      init.body = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    let response: UpstreamResponse;
    try {
      response = await this.deps.fetch(url.toString(), init);
    } catch {
      throw new AppError(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        "A required dependency is unavailable",
        503,
        {
          dependency: "upstream",
        },
      );
    }
    const responseHeaders: Record<string, string> = {};
    const contentType = response.headers.get("content-type");
    const etag = response.headers.get("etag");
    if (contentType !== null) {
      responseHeaders["content-type"] = contentType;
    }
    if (etag !== null) {
      responseHeaders["etag"] = etag;
    }
    return { status: response.status, headers: responseHeaders, body: await response.text() };
  }
}

function bearer(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

function forwardedHeaders(
  request: ProxyRequest,
  claims: AccessTokenClaims | undefined,
  forwardAuthorization: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {};
  copy(headers, "idempotency-key", request.headers["idempotency-key"]);
  copy(headers, "if-match", request.headers["if-match"]);
  copy(headers, "x-correlation-id", request.headers["x-correlation-id"]);
  copy(headers, "x-request-id", request.headers["x-request-id"]);
  if (forwardAuthorization) {
    copy(headers, "authorization", request.headers["authorization"]);
  }
  if (claims !== undefined) {
    headers["x-user-id"] = claims.sub;
    headers["x-user-roles"] = claims.roles.join(",");
  }
  return headers;
}

function copy(target: Record<string, string>, name: string, value: string | undefined): void {
  if (value !== undefined && value.length > 0) {
    target[name] = value;
  }
}
