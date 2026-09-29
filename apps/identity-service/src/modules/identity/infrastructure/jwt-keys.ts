import { readFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { importPKCS8, importSPKI } from "jose";

export interface JwtKeyMaterial {
  privatePem: string;
  publicPem: string;
}

@Injectable()
export class IdentityKeys {
  private material: JwtKeyMaterial | undefined;

  public attach(material: JwtKeyMaterial): void {
    this.material = material;
  }

  public privatePem(): string {
    return this.required().privatePem;
  }

  public publicPem(): string {
    return this.required().publicPem;
  }

  private required(): JwtKeyMaterial {
    if (this.material === undefined) {
      throw new AppError(ErrorCode.CONFIG_INVALID, "JWT signing keys are required", 500, {
        fields: ["JWT_PRIVATE_KEY_PATH", "JWT_PUBLIC_KEY_PATH"],
      });
    }
    return this.material;
  }
}

/**
 * Reads the RS256 pair. The PEM text is not copied into the error or the log.
 */
export async function loadIdentityKeys(auth: {
  privateKeyPath?: string;
  publicKeyPath?: string;
}): Promise<JwtKeyMaterial> {
  if (auth.privateKeyPath === undefined || auth.publicKeyPath === undefined) {
    throw new AppError(ErrorCode.CONFIG_INVALID, "JWT signing keys are required", 500, {
      fields: ["JWT_PRIVATE_KEY_PATH", "JWT_PUBLIC_KEY_PATH"],
    });
  }

  try {
    const privatePem = await readFile(auth.privateKeyPath, "utf8");
    const publicPem = await readFile(auth.publicKeyPath, "utf8");
    await importPKCS8(privatePem, "RS256");
    await importSPKI(publicPem, "RS256");
    return { privatePem, publicPem };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ErrorCode.CONFIG_INVALID, "JWT signing keys are invalid", 500, {
      fields: ["JWT_PRIVATE_KEY_PATH", "JWT_PUBLIC_KEY_PATH"],
    });
  }
}
