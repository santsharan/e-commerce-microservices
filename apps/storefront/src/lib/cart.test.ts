import { describe, expect, it } from "vitest";
import { addLine, cartAmount, cartCurrency, setQuantity, type CartLine } from "./cart";

const hat: CartLine = {
  productId: "p1",
  sku: "HAT-1",
  name: "Hat",
  unitPrice: 2500,
  currency: "USD",
  quantity: 1,
};

describe("cart", () => {
  it("merges the same sku and totals the minor units", () => {
    const lines = addLine([hat], { ...hat, quantity: 2 });
    expect(lines).toEqual([{ ...hat, quantity: 3 }]);
    expect(cartAmount(lines)).toBe(7500);
    expect(cartCurrency(lines)).toBe("USD");
  });

  it("removes a line when the quantity drops below 1", () => {
    expect(setQuantity([hat], "HAT-1", 0)).toEqual([]);
  });

  it("rejects a total when currencies differ", () => {
    expect(cartCurrency([hat, { ...hat, sku: "EUR-1", currency: "EUR" }])).toBeUndefined();
  });
});
