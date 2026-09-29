import pino, { type DestinationStream, type LevelOrString } from "pino";

export interface LogFields {
  event: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
  fatal(fields: LogFields): void;
}

export interface LoggerOptions {
  service: string;
  level: LevelOrString;
  destination?: DestinationStream;
}

const redactPaths = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "secretHash",
  "*.secretHash",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "creditCard",
  "*.creditCard",
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
  "secret",
  "*.secret",
  "token",
  "*.token",
];

/**
 * Structured JSON logger.
 * Secret fields are redacted. Callers pass an `event` name instead of a free-form message.
 */
export function createLogger(options: LoggerOptions): Logger {
  const stream = pino(
    {
      level: options.level,
      base: { service: options.service },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      redact: {
        paths: redactPaths,
        censor: "[Redacted]",
      },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    options.destination,
  );

  const write =
    (level: "debug" | "info" | "warn" | "error" | "fatal") =>
    (fields: LogFields): void => {
      stream[level](fields);
    };

  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    fatal: write("fatal"),
  };
}
