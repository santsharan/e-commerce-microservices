export function securityHeaders(nodeEnv: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'",
    "x-dns-prefetch-control": "off",
  };
  if (nodeEnv === "production") {
    headers["strict-transport-security"] = "max-age=15552000; includeSubDomains";
  }
  return headers;
}

export function corsHeaders(
  origin: string | undefined,
  allowed: readonly string[],
): Record<string, string> | undefined {
  if (origin === undefined || !allowed.includes(origin)) {
    return undefined;
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,idempotency-key,if-match,x-correlation-id,x-request-id",
    vary: "origin",
  };
}
