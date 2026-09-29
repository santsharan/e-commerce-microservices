/** Milliseconds when the access token expires, read from its `exp` claim. */
export function accessExpiresAtMs(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined || payload.length === 0) {
    return undefined;
  }
  try {
    const json: unknown = JSON.parse(decodeBase64Url(payload));
    if (isExpiry(json)) {
      return json.exp * 1000;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function accessTokenIsExpired(token: string, now = Date.now()): boolean {
  const expiresAt = accessExpiresAtMs(token);
  return expiresAt === undefined || expiresAt <= now;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

function isExpiry(value: unknown): value is { exp: number } {
  return (
    typeof value === "object" && value !== null && "exp" in value && typeof value.exp === "number"
  );
}
