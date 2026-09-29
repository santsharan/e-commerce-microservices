import { AppError } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { priceItems } from "./pricing.js";

const hat = {
  productId: "product-1",
  sku: "HAT-1",
  name: "Blue Wool Hat",
  unitPrice: 2500,
  quantity: 2,
};

describe("order pricing", () => {
  it("stores integer line totals and leaves tax at zero", () => {
    const priced = priceItems([hat]);
    expect(priced.items[0]?.subtotal).toBe(5000);
    expect(priced.pricing).toEqual({
      subtotal: 5000,
      discount: 0,
      tax: 0,
      shipping: 0,
      grandTotal: 5000,
    });
  });

  it("rejects a repeated SKU in one order", () => {
    expect(() => priceItems([hat, { ...hat, productId: "product-2" }])).toThrow(AppError);
  });
});
