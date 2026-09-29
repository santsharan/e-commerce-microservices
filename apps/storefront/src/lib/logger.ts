const secretKeys = new Set(["password", "accessToken", "refreshToken", "authorization", "token"]);

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    copy[key] = secretKeys.has(key) ? "[redacted]" : value;
  }
  return copy;
}

export function logEvent(
  level: "info" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    service: "storefront",
    ...redact(fields),
  });
  process.stdout.write(`${line}\n`);
}
