import { AppError, ErrorCode } from "@commerce-flow/errors";
import { CacheKey } from "@commerce-flow/redis";
import { describe, expect, it } from "vitest";
import { CatalogApplication } from "./catalog-application.js";
import type { CatalogCache, CategoryRepository, ProductPage, ProductRepository } from "./ports.js";
import type { ProductListQuery } from "../domain/list-query.js";
import type { Category, Product, ProductVariant } from "../domain/product.js";

const price = { amount: 2500, currency: "USD" };
const variant: ProductVariant = { sku: "HAT-1", name: "Medium", price };

class MemoryCategories implements CategoryRepository {
  private readonly records = new Map<string, Category>();

  public async insert(category: Category): Promise<void> {
    if ([...this.records.values()].some((item) => item.slug === category.slug)) {
      throw new AppError(ErrorCode.CONFLICT, "A category with this slug already exists", 409, {});
    }
    this.records.set(category.id, category);
  }

  public async findById(id: string): Promise<Category | null> {
    return this.records.get(id) ?? null;
  }

  public async list(): Promise<Category[]> {
    return [...this.records.values()];
  }

  public async update(
    id: string,
    version: number,
    category: Category,
  ): Promise<Category | "missing" | "conflict"> {
    const current = this.records.get(id);
    if (current === undefined) {
      return "missing";
    }
    if (current.version !== version) {
      return "conflict";
    }
    const saved = { ...category, version: version + 1 };
    this.records.set(id, saved);
    return saved;
  }

  public async delete(id: string, version: number): Promise<"deleted" | "missing" | "conflict"> {
    const current = this.records.get(id);
    if (current === undefined) {
      return "missing";
    }
    if (current.version !== version) {
      return "conflict";
    }
    this.records.delete(id);
    return "deleted";
  }
}

class MemoryProducts implements ProductRepository {
  public findCalls = 0;
  public listCalls = 0;
  private readonly records = new Map<string, Product>();

  public async insert(product: Product): Promise<void> {
    if ([...this.records.values()].some((item) => item.slug === product.slug)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "The product conflicts with an existing slug or SKU",
        409,
        {},
      );
    }
    this.records.set(product.id, product);
  }

  public async findById(id: string): Promise<Product | null> {
    this.findCalls += 1;
    return this.records.get(id) ?? null;
  }

  public async findBySlug(slug: string): Promise<Product | null> {
    return [...this.records.values()].find((item) => item.slug === slug) ?? null;
  }

  public async findBySkus(
    skus: readonly string[],
    exceptProductId?: string,
  ): Promise<Product | null> {
    return (
      [...this.records.values()].find(
        (item) =>
          item.id !== exceptProductId && item.variants.some((entry) => skus.includes(entry.sku)),
      ) ?? null
    );
  }

  public async list(query: ProductListQuery): Promise<ProductPage> {
    this.listCalls += 1;
    let items = [...this.records.values()];
    if (query.status !== undefined) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.categoryId !== undefined) {
      items = items.filter((item) => item.categoryId === query.categoryId);
    }
    if (query.q !== undefined) {
      const needle = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.slug.includes(needle) ||
          item.variants.some((entry) => entry.sku.toLowerCase().includes(needle)),
      );
    }
    items.sort((left, right) => {
      const leftValue = query.sort === "name" ? left.name : left.createdAt.toISOString();
      const rightValue = query.sort === "name" ? right.name : right.createdAt.toISOString();
      const compared = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
      return query.order === "asc" ? compared : -compared;
    });
    const start = (query.page - 1) * query.limit;
    return {
      items: items.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: items.length,
    };
  }

  public async countByCategory(categoryId: string): Promise<number> {
    return [...this.records.values()].filter((item) => item.categoryId === categoryId).length;
  }

  public async update(
    id: string,
    version: number,
    product: Product,
  ): Promise<Product | "missing" | "conflict"> {
    const current = this.records.get(id);
    if (current === undefined) {
      return "missing";
    }
    if (current.version !== version) {
      return "conflict";
    }
    const saved = { ...product, version: version + 1 };
    this.records.set(id, saved);
    return saved;
  }

  public async delete(id: string, version: number): Promise<"deleted" | "missing" | "conflict"> {
    const current = this.records.get(id);
    if (current === undefined) {
      return "missing";
    }
    if (current.version !== version) {
      return "conflict";
    }
    this.records.delete(id);
    return "deleted";
  }
}

class MemoryCache implements CatalogCache {
  private readonly values = new Map<string, string>();
  private readonly lists = new Set<string>();

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    if (key.startsWith("catalog:list:")) {
      this.lists.add(key);
    }
  }

  public async invalidateProduct(id: string): Promise<void> {
    this.values.delete(CacheKey.product(id));
    for (const key of this.lists) {
      this.values.delete(key);
    }
    this.lists.clear();
  }
}

function catalog(): { app: CatalogApplication; products: MemoryProducts } {
  const products = new MemoryProducts();
  return {
    products,
    app: new CatalogApplication({
      categories: new MemoryCategories(),
      products,
      cache: new MemoryCache(),
      clock: { now: () => new Date("2026-09-25T09:00:00.000Z") },
    }),
  };
}

const listQuery: ProductListQuery = {
  page: 1,
  limit: 20,
  sort: "createdAt",
  order: "desc",
};

describe("catalog application", () => {
  it("caches a product until a write invalidates it", async () => {
    const { app, products } = catalog();
    const category = await app.createCategory({ name: "Hats" });
    const created = await app.createProduct({
      name: "Blue Wool Hat",
      categoryId: category.id,
      variants: [variant],
    });

    expect(created).toMatchObject({ slug: "blue-wool-hat", status: "draft", version: 1 });
    await app.getProduct(created.id);
    await app.getProduct(created.id);
    expect(products.findCalls).toBe(1);

    const updated = await app.updateProduct(created.id, 1, { status: "active" });
    expect(updated.version).toBe(2);
    await app.getProduct(created.id);
    expect(products.findCalls).toBe(3);
    await expect(app.updateProduct(created.id, 1, { name: "Other" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("caches a list until a product write and can search by name", async () => {
    const { app, products } = catalog();
    const category = await app.createCategory({ name: "Hats" });
    await app.createProduct({
      name: "Blue Wool Hat",
      categoryId: category.id,
      status: "active",
      variants: [variant],
    });
    await app.createProduct({
      name: "Wool Coat",
      categoryId: category.id,
      status: "active",
      variants: [{ ...variant, sku: "COAT-1" }],
    });

    const first = await app.listProducts({ ...listQuery, q: "hat" });
    const second = await app.listProducts({ ...listQuery, q: "hat" });
    expect(first.total).toBe(1);
    expect(first.items[0]?.name).toBe("Blue Wool Hat");
    expect(second.total).toBe(1);
    expect(products.listCalls).toBe(1);

    await app.updateProduct(first.items[0]?.id ?? "", 1, { name: "Navy Hat" });
    await app.listProducts({ ...listQuery, q: "navy" });
    expect(products.listCalls).toBe(2);
  });

  it("refuses a duplicate sku and a category that still has products", async () => {
    const { app } = catalog();
    const category = await app.createCategory({ name: "Hats" });
    const product = await app.createProduct({
      name: "Blue Wool Hat",
      categoryId: category.id,
      variants: [variant],
    });
    await expect(
      app.createProduct({
        name: "Another Hat",
        categoryId: category.id,
        variants: [variant],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(app.deleteCategory(category.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    await app.deleteProduct(product.id, 1);
    await app.deleteCategory(category.id, 1);
    await expect(app.getCategory(category.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
