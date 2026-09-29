import { createHash } from "node:crypto";
import { CacheKey } from "@commerce-flow/redis";
import type { ProductStatus } from "./product.js";

export interface ProductListQuery {
  page: number;
  limit: number;
  status?: ProductStatus;
  categoryId?: string;
  q?: string;
  sort: "createdAt" | "name";
  order: "asc" | "desc";
}

export function listCacheKey(query: ProductListQuery): string {
  const canonical = JSON.stringify({
    page: query.page,
    limit: query.limit,
    status: query.status ?? "",
    categoryId: query.categoryId ?? "",
    q: query.q ?? "",
    sort: query.sort,
    order: query.order,
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  return CacheKey.productList(hash);
}
