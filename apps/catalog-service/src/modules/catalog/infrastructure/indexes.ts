import { AppError, ErrorCode } from "@commerce-flow/errors";
import { indexPlan, indexRequests, type IndexRequest } from "@commerce-flow/mongodb";

const extraIndexes: readonly IndexRequest[] = [
  { collection: "categories", name: "categories_id_unique", keys: { id: 1 }, unique: true },
  { collection: "categories", name: "categories_slug_unique", keys: { slug: 1 }, unique: true },
  { collection: "products", name: "products_id_unique", keys: { id: 1 }, unique: true },
  {
    collection: "products",
    name: "products_variant_sku_unique",
    keys: { "variants.sku": 1 },
    unique: true,
  },
];

export function catalogIndexSpecs(): readonly IndexRequest[] {
  return [
    ...indexRequests(indexPlan.filter((spec) => spec.collection === "products")),
    ...extraIndexes,
  ];
}

export async function ensureCatalogIndexes(database: {
  collection(name: string): {
    createIndex(
      keys: Record<string, 1 | -1>,
      options: { name: string; unique: boolean },
    ): Promise<unknown>;
  };
}): Promise<void> {
  for (const spec of catalogIndexSpecs()) {
    await database.collection(spec.collection).createIndex(spec.keys, {
      name: spec.name,
      unique: spec.unique,
    });
  }
}

export function duplicateCategory(): AppError {
  return new AppError(ErrorCode.CONFLICT, "A category with this slug already exists", 409, {});
}
