import { AppError, ErrorCode } from "@commerce-flow/errors";

export const unitPriceMax = 100_000_000;
export const lineQuantityMax = 100;
export const itemCountMax = 20;

export interface PricedItem {
  productId: string;
  sku: string;
  nameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
}

export interface Pricing {
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  grandTotal: number;
}

export interface ItemInput {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

/** Discount, tax, and shipping stay zero until a pricing policy exists. */
export function priceItems(items: readonly ItemInput[]): { items: PricedItem[]; pricing: Pricing } {
  if (items.length === 0 || items.length > itemCountMax) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
  }
  const seen = new Set<string>();
  const priced = items.map((item) => {
    const sku = item.sku.trim();
    if (seen.has(sku)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
    }
    seen.add(sku);
    const quantity = item.quantity;
    const unitPrice = item.unitPrice;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > lineQuantityMax) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
    }
    if (!Number.isInteger(unitPrice) || unitPrice < 0 || unitPrice > unitPriceMax) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
    }
    const subtotal = unitPrice * quantity;
    if (!Number.isSafeInteger(subtotal)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
    }
    return {
      productId: item.productId.trim(),
      sku,
      nameSnapshot: item.name.trim(),
      unitPriceSnapshot: unitPrice,
      quantity,
      subtotal,
    };
  });
  const subtotal = priced.reduce((sum, item) => sum + item.subtotal, 0);
  if (!Number.isSafeInteger(subtotal)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields: ["items"] });
  }
  return {
    items: priced,
    pricing: { subtotal, discount: 0, tax: 0, shipping: 0, grandTotal: subtotal },
  };
}
