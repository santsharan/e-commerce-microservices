import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { ProductPage, ProductRepository } from "../application/ports.js";
import type { ProductListQuery } from "../domain/list-query.js";
import type { Product } from "../domain/product.js";
import { requireMongo } from "./mongo-support.js";
import { duplicateProduct, isDuplicateKey } from "./redis-catalog-cache.js";

interface ProductDocument {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: Product["status"];
  categoryId: string;
  variants: Product["variants"];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoProductRepository implements ProductRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(product: Product): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<ProductDocument>("products")
        .insertOne({
          ...product,
          variants: product.variants.map((variant) => ({
            ...variant,
            price: { ...variant.price },
          })),
        });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw duplicateProduct();
      }
      throw error;
    }
  }

  public async findById(id: string): Promise<Product | null> {
    const document = await requireMongo(this.registry)
      .database.collection<ProductDocument>("products")
      .findOne({ id });
    return document === null ? null : toProduct(document);
  }

  public async findBySlug(slug: string): Promise<Product | null> {
    const document = await requireMongo(this.registry)
      .database.collection<ProductDocument>("products")
      .findOne({ slug });
    return document === null ? null : toProduct(document);
  }

  public async findBySkus(
    skus: readonly string[],
    exceptProductId?: string,
  ): Promise<Product | null> {
    const filter: Record<string, unknown> = { "variants.sku": { $in: [...skus] } };
    if (exceptProductId !== undefined) {
      filter["id"] = { $ne: exceptProductId };
    }
    const document = await requireMongo(this.registry)
      .database.collection<ProductDocument>("products")
      .findOne(filter);
    return document === null ? null : toProduct(document);
  }

  public async list(query: ProductListQuery): Promise<ProductPage> {
    const collection = requireMongo(this.registry).database.collection<ProductDocument>("products");
    const filter = listFilter(query);
    const direction = query.order === "asc" ? 1 : -1;
    const [total, documents] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter)
        .sort({ [query.sort]: direction })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .toArray(),
    ]);
    return {
      items: documents.map(toProduct),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  public async countByCategory(categoryId: string): Promise<number> {
    return requireMongo(this.registry)
      .database.collection<ProductDocument>("products")
      .countDocuments({ categoryId });
  }

  public async update(
    id: string,
    version: number,
    product: Product,
  ): Promise<Product | "missing" | "conflict"> {
    const updated = await requireMongo(this.registry)
      .database.collection<ProductDocument>("products")
      .findOneAndUpdate(
        { id, version },
        {
          $set: {
            name: product.name,
            slug: product.slug,
            description: product.description,
            status: product.status,
            categoryId: product.categoryId,
            variants: product.variants,
            updatedAt: product.updatedAt,
            version: version + 1,
          },
        },
        { returnDocument: "after" },
      );
    if (updated !== null) {
      return toProduct(updated);
    }
    const existing = await this.findById(id);
    return existing === null ? "missing" : "conflict";
  }

  public async delete(id: string, version: number): Promise<"deleted" | "missing" | "conflict"> {
    const deleted = await requireMongo(this.registry)
      .database.collection<ProductDocument>("products")
      .deleteOne({ id, version });
    if (deleted.deletedCount === 1) {
      return "deleted";
    }
    const existing = await this.findById(id);
    return existing === null ? "missing" : "conflict";
  }
}

function listFilter(query: ProductListQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.status !== undefined) {
    filter["status"] = query.status;
  }
  if (query.categoryId !== undefined) {
    filter["categoryId"] = query.categoryId;
  }
  if (query.q !== undefined && query.q.length > 0) {
    const pattern = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter["$or"] = [
      { name: { $regex: pattern, $options: "i" } },
      { slug: { $regex: pattern, $options: "i" } },
      { "variants.sku": { $regex: pattern, $options: "i" } },
    ];
  }
  return filter;
}

function toProduct(document: ProductDocument): Product {
  return {
    id: document.id,
    name: document.name,
    slug: document.slug,
    description: document.description,
    status: document.status,
    categoryId: document.categoryId,
    variants: document.variants.map((variant) => ({
      sku: variant.sku,
      name: variant.name,
      price: { amount: variant.price.amount, currency: variant.price.currency },
    })),
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
