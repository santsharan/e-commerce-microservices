import { describe, expect, it } from "vitest";
import { catalogIndexSpecs } from "./indexes.js";

describe("catalog indexes", () => {
  it("keeps the architecture product indexes and adds category and sku uniqueness", () => {
    const names = catalogIndexSpecs().map((spec) => spec.name);
    expect(names).toEqual([
      "products_slug_unique",
      "products_category_id",
      "products_status",
      "products_created_at",
      "categories_id_unique",
      "categories_slug_unique",
      "products_id_unique",
      "products_variant_sku_unique",
    ]);
    expect(catalogIndexSpecs().find((spec) => spec.name === "products_slug_unique")?.unique).toBe(
      true,
    );
  });
});
