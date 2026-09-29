export const ProductStatus = {
  draft: "draft",
  active: "active",
  archived: "archived",
} as const;

export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export interface Money {
  amount: number;
  currency: string;
}

export interface ProductVariant {
  sku: string;
  name: string;
  price: Money;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: ProductStatus;
  categoryId: string;
  variants: ProductVariant[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductPatch {
  name?: string;
  slug?: string;
  description?: string;
  status?: ProductStatus;
  categoryId?: string;
  variants?: ProductVariant[];
}

/** New products stay unpublished until a caller sets them active. */
export const defaultProductStatus: ProductStatus = ProductStatus.draft;

/** Cache entries expire quickly. Writes also delete them. */
export const catalogCacheTtlSeconds = 60;

export const pageLimitDefault = 20;
export const pageLimitMax = 100;

const statuses = new Set<string>(Object.values(ProductStatus));

export function isProductStatus(value: string): value is ProductStatus {
  return statuses.has(value);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function etagFor(version: number): string {
  return `"${version}"`;
}
