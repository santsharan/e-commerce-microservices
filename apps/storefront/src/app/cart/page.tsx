"use client";

import Link from "next/link";
import { Button } from "@/components/atoms/button";
import { Money } from "@/components/atoms/money";
import { setQuantity, cartCurrency, cartAmount } from "@/lib/cart";
import { useLocalCart } from "@/components/organisms/use-local-cart";

export default function CartPage() {
  const cart = useLocalCart();
  const currency = cartCurrency(cart.lines);
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold">Cart</h1>
      {cart.lines.length === 0 ? (
        <p className="text-sm text-stone-600">
          Your cart is empty. <Link href="/">Browse the catalog</Link>
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {cart.lines.map((line) => (
            <li key={line.sku} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium">{line.name}</p>
                <p className="text-sm text-stone-500">{line.sku}</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  aria-label={`Quantity for ${line.name}`}
                  className="w-16 rounded-md border border-stone-300 px-2 py-1 text-sm"
                  type="number"
                  min={1}
                  max={100}
                  value={line.quantity}
                  onChange={(event) => {
                    cart.replace(setQuantity(cart.lines, line.sku, Number(event.target.value)));
                  }}
                />
                <Money amount={line.unitPrice * line.quantity} currency={line.currency} />
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => cart.replace(setQuantity(cart.lines, line.sku, 0))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {currency === undefined ? null : (
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">
            Total <Money amount={cartAmount(cart.lines)} currency={currency} />
          </p>
          <Link href="/checkout" className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white">
            Checkout
          </Link>
        </div>
      )}
    </section>
  );
}
