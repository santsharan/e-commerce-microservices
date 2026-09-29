"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/atoms/button";
import { Money } from "@/components/atoms/money";
import { cartAmount, cartCurrency } from "@/lib/cart";
import { useLocalCart } from "@/components/organisms/use-local-cart";
import { placeOrder } from "@/server/actions";

export default function CheckoutPage() {
  const cart = useLocalCart();
  const router = useRouter();
  const currency = cartCurrency(cart.lines);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  return (
    <section className="mx-auto max-w-lg space-y-4">
      <h1 className="text-3xl font-semibold">Checkout</h1>
      <p className="text-sm text-stone-600">
        Placing the order reserves stock and asks the payment service to authorize the total. Card
        numbers are not collected or stored.
      </p>
      {currency === undefined ? (
        <p className="text-sm">Add products in one currency before checkout.</p>
      ) : (
        <>
          <p className="text-lg font-semibold">
            Pay <Money amount={cartAmount(cart.lines)} currency={currency} />
          </p>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              const key = crypto.randomUUID();
              void placeOrder(cart.lines, key).then((result) => {
                if ("id" in result) {
                  cart.replace([]);
                  router.push(`/orders/${result.id}`);
                  return;
                }
                if (result.expired === true) {
                  window.location.assign("/login?expired=1");
                  return;
                }
                setError(result.error);
                setPending(false);
              });
            }}
          >
            Place order
          </Button>
        </>
      )}
      {error === undefined ? null : <p className="text-sm text-rose-700">{error}</p>}
    </section>
  );
}
