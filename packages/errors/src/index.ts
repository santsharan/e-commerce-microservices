import type { ApiErrorBody } from "@commerce-flow/contracts";

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_REQUIRED: "PRECONDITION_REQUIRED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  CONFIG_INVALID: "CONFIG_INVALID",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Client-safe application error.
 * `message` and `details` are returned to callers, so they must not contain
 * secrets, stack traces, or infrastructure internals.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown>;

  public constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface PublicError {
  statusCode: number;
  body: ApiErrorBody;
}

const statusMessages: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: ErrorCode.VALIDATION_ERROR, message: "The request is invalid" },
  401: { code: ErrorCode.UNAUTHORIZED, message: "Authentication is required" },
  403: { code: ErrorCode.FORBIDDEN, message: "You do not have access to this resource" },
  404: { code: ErrorCode.NOT_FOUND, message: "The requested resource was not found" },
  409: {
    code: ErrorCode.CONFLICT,
    message: "The request conflicts with the current resource state",
  },
  413: { code: ErrorCode.PAYLOAD_TOO_LARGE, message: "The request body is too large" },
  429: { code: ErrorCode.RATE_LIMITED, message: "Too many requests" },
};

export function publicHttpError(statusCode: number, requestId: string): PublicError {
  const mapped = statusMessages[statusCode];
  if (mapped === undefined) {
    return {
      statusCode: statusCode >= 500 ? 500 : statusCode,
      body: {
        error: {
          code: statusCode >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR,
          message:
            statusCode >= 500
              ? "An unexpected error occurred"
              : "The request could not be processed",
          requestId,
          details: {},
        },
      },
    };
  }

  return {
    statusCode,
    body: {
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId,
        details: {},
      },
    },
  };
}

/**
 * Maps any thrown value to the public error envelope.
 * Unknown failures keep their detail on the server; clients receive a generic message.
 */
export function toPublicError(error: unknown, requestId: string): PublicError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          details: error.details,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: "An unexpected error occurred",
        requestId,
        details: {},
      },
    },
  };
}

/**
 * Removes URL userinfo that drivers copy into exception text.
 * The rest of the message stays so operators can see the host and reason.
 */
export function redactCredentials(text: string): string {
  return text.replace(/\/\/(?:[^/\s@]+)@/g, "//");
}
