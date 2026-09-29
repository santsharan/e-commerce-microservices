export interface IdentityIndexSpec {
  collection: string;
  name: string;
  keys: Record<string, 1 | -1>;
  unique: boolean;
}

export const identityIndexSpecs: readonly IdentityIndexSpec[] = [
  { collection: "users", name: "users_id_unique", keys: { id: 1 }, unique: true },
  { collection: "users", name: "users_email_unique", keys: { email: 1 }, unique: true },
  {
    collection: "refresh_tokens",
    name: "refresh_tokens_token_id_unique",
    keys: { tokenId: 1 },
    unique: true,
  },
  {
    collection: "refresh_tokens",
    name: "refresh_tokens_family",
    keys: { familyId: 1 },
    unique: false,
  },
  { collection: "refresh_tokens", name: "refresh_tokens_user", keys: { userId: 1 }, unique: false },
  {
    collection: "audit_logs",
    name: "audit_logs_created_at",
    keys: { createdAt: 1 },
    unique: false,
  },
];

export async function ensureIdentityIndexes(database: {
  collection(name: string): {
    createIndex(
      keys: Record<string, 1 | -1>,
      options: { name: string; unique: boolean },
    ): Promise<unknown>;
  };
}): Promise<void> {
  for (const spec of identityIndexSpecs) {
    await database.collection(spec.collection).createIndex(spec.keys, {
      name: spec.name,
      unique: spec.unique,
    });
  }
}
