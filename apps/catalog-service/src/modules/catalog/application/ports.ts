import type { CacheStore } from "@commerce-flow/redis";
import type { ProductListQuery } from "../domain/list-query.js";
import type { Category, Product } from "../domain/product.js";

export interface ProductPage {
  items: Product[];
  page: number;
  limit: number;
  total: number;
}

export interface CategoryRepository {
  insert(category: Category): Promise<void>;
  findById(id: string): Promise<Category | null>;
  list(): Promise<Category[]>;
  update(
    id: string,
    version: number,
    category: Category,
  ): Promise<Category | "missing" | "conflict">;
  delete(id: string, version: number): Promise<"deleted" | "missing" | "conflict">;
}

export interface ProductRepository {
  insert(product: Product): Promise<void>;
  findById(id: string): Promise<Product | null>;
  findBySlug(slug: string): Promise<Product | null>;
  findBySkus(skus: readonly string[], exceptProductId?: string): Promise<Product | null>;
  list(query: ProductListQuery): Promise<ProductPage>;
  countByCategory(categoryId: string): Promise<number>;
  update(id: string, version: number, product: Product): Promise<Product | "missing" | "conflict">;
  delete(id: string, version: number): Promise<"deleted" | "missing" | "conflict">;
}

export interface CatalogCache extends CacheStore {
  invalidateProduct(id: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
