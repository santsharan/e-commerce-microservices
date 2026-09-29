import { readFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { assertSpki } from "@commerce-flow/auth";
import { AppError, ErrorCode } from "@commerce-flow/errors";

@Injectable()
export class GatewayKeys {
  private publicPem: string | undefined;

  public attach(publicPem: string): void {
    this.publicPem = publicPem;
  }

  public publicKey(): string {
    if (this.publicPem === undefined) {
      throw new AppError(ErrorCode.CONFIG_INVALID, "JWT public key is required", 500, {
        fields: ["JWT_PUBLIC_KEY_PATH"],
      });
    }
    return this.publicPem;
  }
}

export async function loadGatewayPublicKey(path: string | undefined): Promise<string> {
  if (path === undefined) {
    throw new AppError(ErrorCode.CONFIG_INVALID, "JWT public key is required", 500, {
      fields: ["JWT_PUBLIC_KEY_PATH"],
    });
  }
  try {
    const publicPem = await readFile(path, "utf8");
    await assertSpki(publicPem);
    return publicPem;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ErrorCode.CONFIG_INVALID, "JWT public key is invalid", 500, {
      fields: ["JWT_PUBLIC_KEY_PATH"],
    });
  }
}
