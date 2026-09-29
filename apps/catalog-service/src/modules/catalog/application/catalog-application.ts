import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { CacheKey, cacheAside } from "@commerce-flow/redis";
import { recordCacheHit, recordCacheMiss } from "@commerce-flow/observability";
import type {
  CatalogCache,
  CategoryRepository,
  Clock,
  ProductPage,
  ProductRepository,
} from "./ports.js";
import { listCacheKey, type ProductListQuery } from "../domain/list-query.js";
import {
  catalogCacheTtlSeconds,
  defaultProductStatus,
  slugify,
  type Category,
  type Product,
  type ProductPatch,
  type ProductVariant,
} from "../domain/product.js";

export interface CreateCategoryInput {
  name: string;
  slug?: string;
}

export interface CreateProductInput {
  name: string;
  slug?: string;
  description?: string;
  status?: Product["status"];
  categoryId: string;
  variants: ProductVariant[];
}

export interface CatalogDependencies {
  categories: CategoryRepository;
  products: ProductRepository;
  cache: CatalogCache;
  clock: Clock;
}

interface SerializedProduct extends Omit<Product, "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt: string;
}

interface SerializedPage extends Omit<ProductPage, "items"> {
  items: SerializedProduct[];
}

export class CatalogApplication {
  public constructor(private readonly deps: CatalogDependencies) {}

  public async createCategory(input: CreateCategoryInput): Promise<Category> {
    const now = this.deps.clock.now();
    const category: Category = {
      id: randomUUID(),
      name: requireName(input.name),
      slug: requireSlug(input.slug ?? input.name),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.categories.insert(category);
    return category;
  }

  public async listCategories(): Promise<Category[]> {
    return this.deps.categories.list();
  }

  public async getCategory(id: string): Promise<Category> {
    const category = await this.deps.categories.findById(id);
    if (category === null) {
      throw notFound("Category was not found");
    }
    return category;
  }

  public async updateCategory(
    id: string,
    version: number,
    input: { name?: string; slug?: string },
  ): Promise<Category> {
    const current = await this.getCategory(id);
    const next: Category = {
      ...current,
      name: input.name === undefined ? current.name : requireName(input.name),
      slug: input.slug === undefined ? current.slug : requireSlug(input.slug),
      updatedAt: this.deps.clock.now(),
    };
    if (input.name === undefined && input.slug === undefined) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["body"] });
    }
    return this.finishCategoryUpdate(id, version, next);
  }

  public async deleteCategory(id: string, version: number): Promise<void> {
    const count = await this.deps.products.countByCategory(id);
    if (count > 0) {
      throw new AppError(ErrorCode.CONFLICT, "The category still has products", 409, {});
    }
    const outcome = await this.deps.categories.delete(id, version);
    if (outcome === "missing") {
      throw notFound("Category was not found");
    }
    if (outcome === "conflict") {
      throw conflict("The category was updated by someone else");
    }
  }

  public async createProduct(input: CreateProductInput): Promise<Product> {
    await this.getCategory(input.categoryId);
    const variants = requireVariants(input.variants);
    await this.assertSkusAvailable(variants);
    const now = this.deps.clock.now();
    const product: Product = {
      id: randomUUID(),
      name: requireName(input.name),
      slug: requireSlug(input.slug ?? input.name),
      description: requireDescription(input.description ?? ""),
      status: input.status ?? defaultProductStatus,
      categoryId: input.categoryId,
      variants,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.products.insert(product);
    await this.deps.cache.invalidateProduct(product.id);
    return product;
  }

  public async getProduct(id: string): Promise<Product> {
    return cacheAside({
      store: this.deps.cache,
      domain: "catalog",
      key: CacheKey.product(id),
      ttlSeconds: catalogCacheTtlSeconds,
      load: async () => {
        const product = await this.deps.products.findById(id);
        if (product === null) {
          throw notFound("Product was not found");
        }
        return product;
      },
      serialize: (product) => JSON.stringify(serializeProduct(product)),
      deserialize: deserializeProduct,
      onHit: recordCacheHit,
      onMiss: recordCacheMiss,
    });
  }

  public async listProducts(query: ProductListQuery): Promise<ProductPage> {
    const key = listCacheKey(query);
    return cacheAside({
      store: this.deps.cache,
      domain: "catalog",
      key,
      ttlSeconds: catalogCacheTtlSeconds,
      load: () => this.deps.products.list(query),
      serialize: (page) => JSON.stringify(serializePage(page)),
      deserialize: deserializePage,
      onHit: recordCacheHit,
      onMiss: recordCacheMiss,
    });
  }

  public async updateProduct(id: string, version: number, patch: ProductPatch): Promise<Product> {
    if (
      patch.name === undefined &&
      patch.slug === undefined &&
      patch.description === undefined &&
      patch.status === undefined &&
      patch.categoryId === undefined &&
      patch.variants === undefined
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["body"] });
    }
    const current = await this.deps.products.findById(id);
    if (current === null) {
      throw notFound("Product was not found");
    }
    if (patch.categoryId !== undefined) {
      await this.getCategory(patch.categoryId);
    }
    const variants =
      patch.variants === undefined ? current.variants : requireVariants(patch.variants);
    if (patch.variants !== undefined) {
      await this.assertSkusAvailable(variants, id);
    }
    const next: Product = {
      ...current,
      name: patch.name === undefined ? current.name : requireName(patch.name),
      slug: patch.slug === undefined ? current.slug : requireSlug(patch.slug),
      description:
        patch.description === undefined
          ? current.description
          : requireDescription(patch.description),
      status: patch.status ?? current.status,
      categoryId: patch.categoryId ?? current.categoryId,
      variants,
      updatedAt: this.deps.clock.now(),
    };
    const outcome = await this.deps.products.update(id, version, next);
    if (outcome === "missing") {
      throw notFound("Product was not found");
    }
    if (outcome === "conflict") {
      throw conflict("The product was updated by someone else");
    }
    await this.deps.cache.invalidateProduct(id);
    return outcome;
  }

  public async deleteProduct(id: string, version: number): Promise<void> {
    const outcome = await this.deps.products.delete(id, version);
    if (outcome === "missing") {
      throw notFound("Product was not found");
    }
    if (outcome === "conflict") {
      throw conflict("The product was updated by someone else");
    }
    await this.deps.cache.invalidateProduct(id);
  }

  private async finishCategoryUpdate(
    id: string,
    version: number,
    next: Category,
  ): Promise<Category> {
    const outcome = await this.deps.categories.update(id, version, next);
    if (outcome === "missing") {
      throw notFound("Category was not found");
    }
    if (outcome === "conflict") {
      throw conflict("The category was updated by someone else");
    }
    return outcome;
  }

  private async assertSkusAvailable(
    variants: readonly ProductVariant[],
    exceptProductId?: string,
  ): Promise<void> {
    const existing = await this.deps.products.findBySkus(
      variants.map((variant) => variant.sku),
      exceptProductId,
    );
    if (existing !== null) {
      throw new AppError(ErrorCode.CONFLICT, "A variant SKU already exists", 409, {});
    }
  }
}

function notFound(message: string): AppError {
  return new AppError(ErrorCode.NOT_FOUND, message, 404, {});
}

function conflict(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message, 409, {});
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["name"] });
  }
  return trimmed;
}

function requireSlug(value: string): string {
  const slug = slugify(value);
  if (slug.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["slug"] });
  }
  return slug;
}

function requireDescription(description: string): string {
  if (description.length > 5_000) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["description"],
    });
  }
  return description;
}

function requireVariants(variants: readonly ProductVariant[]): ProductVariant[] {
  if (variants.length === 0 || variants.length > 50) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
      fields: ["variants"],
    });
  }
  const seen = new Set<string>();
  return variants.map((variant) => {
    const sku = variant.sku.trim();
    const name = variant.name.trim();
    const currency = variant.price.currency.trim().toUpperCase();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(sku) || seen.has(sku)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
        fields: ["variants"],
      });
    }
    seen.add(sku);
    if (name.length === 0 || name.length > 200) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
        fields: ["variants"],
      });
    }
    if (
      !Number.isInteger(variant.price.amount) ||
      variant.price.amount < 0 ||
      variant.price.amount > 100_000_000 ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, {
        fields: ["variants"],
      });
    }
    return { sku, name, price: { amount: variant.price.amount, currency } };
  });
}

function serializeProduct(product: Product): SerializedProduct {
  return {
    ...product,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function serializePage(page: ProductPage): SerializedPage {
  return { ...page, items: page.items.map(serializeProduct) };
}

function deserializeProduct(raw: string): Product {
  const parsed: unknown = JSON.parse(raw);
  if (!isSerializedProduct(parsed)) {
    throw new Error("corrupt catalog cache");
  }
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

function deserializePage(raw: string): ProductPage {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("items" in parsed) ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("corrupt catalog cache");
  }
  const page = parsed as SerializedPage;
  return {
    page: page.page,
    limit: page.limit,
    total: page.total,
    items: page.items.map((item) => deserializeProduct(JSON.stringify(item))),
  };
}

function isSerializedProduct(value: unknown): value is SerializedProduct {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "id" in value &&
    "createdAt" in value &&
    "updatedAt" in value &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}
