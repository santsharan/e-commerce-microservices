import { AppError, ErrorCode } from "@commerce-flow/errors";
import { Role, type Role as RoleName } from "@commerce-flow/auth";
import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { UserRecord, UserRepository } from "../application/ports.js";
import { isDuplicateKey, requireMongo } from "./mongo-support.js";

interface UserDocument {
  id: string;
  email: string;
  passwordHash: string;
  roles: string[];
  createdAt: Date;
}

const knownRoles = new Set<string>(Object.values(Role));

function isRole(value: string): value is RoleName {
  return knownRoles.has(value);
}

export class MongoUserRepository implements UserRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(user: UserRecord): Promise<void> {
    const collection = requireMongo(this.registry).database.collection<UserDocument>("users");
    try {
      await collection.insertOne({
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        roles: [...user.roles],
        createdAt: user.createdAt,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "An account with this email already exists",
          409,
          {},
        );
      }
      throw error;
    }
  }

  public async findByEmail(email: string): Promise<UserRecord | null> {
    const document = await requireMongo(this.registry)
      .database.collection<UserDocument>("users")
      .findOne({ email });
    return document === null ? null : toUser(document);
  }

  public async findById(id: string): Promise<UserRecord | null> {
    const document = await requireMongo(this.registry)
      .database.collection<UserDocument>("users")
      .findOne({ id });
    return document === null ? null : toUser(document);
  }
}

function toUser(document: UserDocument): UserRecord {
  return {
    id: document.id,
    email: document.email,
    passwordHash: document.passwordHash,
    roles: document.roles.filter(isRole),
    createdAt: document.createdAt,
  };
}
