"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/atoms/button";
import { Money } from "@/components/atoms/money";
import { addLine, type CartLine } from "@/lib/cart";
import type { Product } from "@/lib/types";
import { useLocalCart } from "@/components/organisms/use-local-cart";

export function ProductCard({ product }: { product: Product }) {
  const variant = product.variants[0];
  const cart = useLocalCart();
  const [note, setNote] = useState<string | undefined>();
  if (variant === undefined) {
    return null;
  }
  return (
    <article className="flex flex-col justify-between rounded-lg border border-stone-200 bg-white p-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          <Link href={`/products/${product.id}`}>{product.name}</Link>
        </h2>
        <p className="text-sm text-stone-600">{variant.name}</p>
        <p className="font-medium">
          <Money amount={variant.price.amount} currency={variant.price.currency} />
        </p>
      </div>
      <div className="mt-4 space-y-2">
        <Button
          type="button"
          onClick={() => {
            const line: CartLine = {
              productId: product.id,
              sku: variant.sku,
              name: product.name,
              unitPrice: variant.price.amount,
              currency: variant.price.currency,
              quantity: 1,
            };
            if (
              cart.lines.length > 0 &&
              cart.lines.some((item) => item.currency !== line.currency)
            ) {
              setNote("This product uses a different currency.");
              return;
            }
            const next = addLine(cart.lines, line);
            if (
              next.length === cart.lines.length &&
              !cart.lines.some((item) => item.sku === line.sku)
            ) {
              setNote("The cart is full.");
              return;
            }
            cart.replace(next);
            setNote("Added to cart.");
          }}
        >
          Add to cart
        </Button>
        {note === undefined ? null : <p className="text-xs text-stone-500">{note}</p>}
      </div>
    </article>
  );
}
