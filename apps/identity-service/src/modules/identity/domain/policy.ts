/** Access tokens follow the architecture note of about 15 minutes. */
export const accessTokenTtlSeconds = 15 * 60;

/** Refresh tokens follow the architecture note of about 7 days. */
export const refreshTokenTtlSeconds = 7 * 24 * 60 * 60;

/**
 * The architecture does not set a password length.
 * Twelve characters is the minimum accepted here. The value is not logged.
 */
export const passwordMinLength = 12;
export const passwordMaxLength = 128;

/**
 * OWASP Argon2id parameters: 19 MiB, 2 iterations, parallelism 1.
 * Passwords use Argon2id. Refresh tokens are random and are stored as SHA-256.
 */
export const argon2idParams = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
