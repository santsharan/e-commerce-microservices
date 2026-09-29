"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/atoms/button";
import { Money } from "@/components/atoms/money";
import { StatusBadge } from "@/components/atoms/status-badge";
import type { Order } from "@/lib/types";
import { cancelOrder, getOrder } from "@/server/actions";

export function OrderDetail({ initial, etag }: { initial: Order; etag: string }) {
  const [order, setOrder] = useState(initial);
  const [versionTag, setVersionTag] = useState(etag);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (order.status === "confirmed" || order.status === "failed" || order.status === "cancelled") {
      return;
    }
    const timer = setInterval(() => {
      void getOrder(order.id).then((next) => {
        if (next === "expired") {
          window.location.assign("/login?expired=1");
          return;
        }
        if (next !== null) {
          setOrder(next.order);
          setVersionTag(next.etag);
        }
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [order.id, order.status]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">{order.orderNumber}</h1>
        <StatusBadge status={order.status} paymentStatus={order.payment.status} />
      </div>
      <p className="text-sm text-stone-600">
        Saga {order.saga.state}. Payment {order.payment.status}.
      </p>
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        {order.items.map((item) => (
          <li key={item.sku} className="flex justify-between p-4 text-sm">
            <span>
              {item.nameSnapshot} × {item.quantity}
            </span>
            <Money amount={item.subtotal} currency={order.currency} />
          </li>
        ))}
      </ul>
      <p className="text-lg font-semibold">
        Total <Money amount={order.pricing.grandTotal} currency={order.currency} />
      </p>
      {order.status === "pending" || order.status === "cancelling" ? (
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            void cancelOrder(order.id, versionTag).then((result) => {
              if (result.expired === true) {
                window.location.assign("/login?expired=1");
                return;
              }
              if (result.error !== undefined) {
                setError(result.error);
              }
            });
          }}
        >
          Cancel order
        </Button>
      ) : null}
      {error === undefined ? null : <p className="text-sm text-rose-700">{error}</p>}
    </section>
  );
}
