import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, tap } from "rxjs";
import type { Logger } from "@commerce-flow/logger";
import { activeTraceId, recordHttpRequest } from "@commerce-flow/observability";
import { LOGGER } from "../bootstrap/tokens.js";

interface HttpRequestLike {
  id?: string | number;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

interface HttpReplyLike {
  statusCode: number;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  public constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    if (request.url.startsWith("/health") || request.url.startsWith("/metrics")) {
      return next.handle();
    }

    const started = Date.now();
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<HttpReplyLike>();
        const durationMs = Date.now() - started;
        const correlationId = headerValue(request.headers["x-correlation-id"]);
        const traceId = activeTraceId();
        this.logger.info({
          event: "http.request.completed",
          requestId: request.id === undefined ? "unknown" : String(request.id),
          ...(correlationId === undefined ? {} : { correlationId }),
          ...(traceId === undefined ? {} : { traceId }),
          method: request.method,
          path: request.url.split("?")[0] ?? request.url,
          statusCode: response.statusCode,
          durationMs,
        });
        recordHttpRequest({
          method: request.method,
          statusCode: response.statusCode,
          durationMs,
        });
      }),
    );
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
