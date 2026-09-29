import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { API_PREFIX } from "@commerce-flow/contracts";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";
import type { SessionResponse, UserProfile } from "../application/identity-application.js";
import { IdentityApplication } from "../application/identity-application.js";
import { passwordMaxLength, passwordMinLength } from "../domain/policy.js";

const credentials = z.object({
  email: z.email(),
  password: z.string().min(passwordMinLength).max(passwordMaxLength),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

interface HttpRequest {
  id?: string | number;
  headers: { authorization?: string };
}

@Controller(`${API_PREFIX.slice(1)}/users`)
export class UsersController {
  public constructor(private readonly identity: IdentityApplication) {}

  @Post("register")
  @HttpCode(201)
  public register(@Body() body: unknown, @Req() request: HttpRequest): Promise<SessionResponse> {
    return this.identity.register(parse(credentials, body), requestId(request));
  }

  @Post("login")
  public login(@Body() body: unknown, @Req() request: HttpRequest): Promise<SessionResponse> {
    return this.identity.login(parse(credentials, body), requestId(request));
  }

  @Post("refresh")
  public refresh(@Body() body: unknown, @Req() request: HttpRequest): Promise<SessionResponse> {
    const parsed = parse(refreshBody, body);
    return this.identity.refresh(parsed.refreshToken, requestId(request));
  }

  @Post("logout")
  @HttpCode(204)
  public async logout(@Body() body: unknown, @Req() request: HttpRequest): Promise<void> {
    const parsed = parse(refreshBody, body);
    await this.identity.logout(parsed.refreshToken, requestId(request));
  }

  @Get("me")
  public me(@Req() request: HttpRequest): Promise<UserProfile> {
    const token = bearer(request.headers.authorization);
    if (token === undefined) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Authentication is required", 401, {});
    }
    return this.identity.currentUser(token);
  }
}

function requestId(request: HttpRequest): string {
  if (request.id === undefined) {
    return "unknown";
  }
  const value = String(request.id).trim();
  return value.length === 0 ? "unknown" : value;
}

function bearer(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const separator = header.indexOf(" ");
  if (separator <= 0) {
    return undefined;
  }
  const scheme = header.slice(0, separator);
  const token = header.slice(separator + 1).trim();
  if (scheme !== "Bearer" || token.length === 0) {
    return undefined;
  }
  return token;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const fields = [
    ...new Set(
      parsed.error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === "string" ? field : "body";
      }),
    ),
  ];
  throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields });
}
