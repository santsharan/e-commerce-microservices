import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { AppError, publicHttpError, toPublicError, type PublicError } from "@commerce-flow/errors";
import type { Logger } from "@commerce-flow/logger";
import { LOGGER } from "../bootstrap/tokens.js";

interface HttpRequestLike {
  id?: string | number;
}

interface HttpReplyLike {
  status(code: number): HttpReplyLike;
  send(body: unknown): unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<HttpRequestLike>();
    const reply = host.switchToHttp().getResponse<HttpReplyLike>();
    const requestId = request.id === undefined ? "unknown" : String(request.id);
    const mapped = mapException(exception, requestId);

    this.logger.error({
      event: "http.request.failed",
      requestId,
      statusCode: mapped.statusCode,
      code: mapped.body.error.code,
      errorName: exception instanceof Error ? exception.name : "UnknownError",
      serverMessage: exception instanceof Error ? exception.message : "unknown",
    });

    reply.status(mapped.statusCode).send(mapped.body);
  }
}

function mapException(exception: unknown, requestId: string): PublicError {
  if (exception instanceof HttpException && !(exception instanceof AppError)) {
    return publicHttpError(exception.getStatus(), requestId);
  }
  return toPublicError(exception, requestId);
}
