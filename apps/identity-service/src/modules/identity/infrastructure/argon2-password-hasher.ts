import { hash, verify } from "@node-rs/argon2";
import { argon2idParams } from "../domain/policy.js";
import type { PasswordHasher } from "../application/ports.js";

/**
 * `@node-rs/argon2` defaults to Argon2id. The algorithm is not passed as a
 * const enum because verbatim module syntax cannot emit that import.
 * Callers still check that the stored hash begins with `$argon2id$`.
 */
const options = {
  memoryCost: argon2idParams.memoryCost,
  timeCost: argon2idParams.timeCost,
  parallelism: argon2idParams.parallelism,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  private placeholder: Promise<string> | undefined;

  public hash(password: string): Promise<string> {
    return hash(password, options);
  }

  public async verify(password: string, passwordHash: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password, options);
    } catch {
      return false;
    }
  }

  public placeholderHash(): Promise<string> {
    this.placeholder ??= this.hash("not-a-registered-user");
    return this.placeholder;
  }
}
