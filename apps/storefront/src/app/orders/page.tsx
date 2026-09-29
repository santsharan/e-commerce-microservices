import Link from "next/link";
import { StatusBadge } from "@/components/atoms/status-badge";
import { Money } from "@/components/atoms/money";
import { currentUser, listOrders } from "@/server/data";

export default async function OrdersPage() {
  const user = await currentUser();
  if (user === null) {
    return (
      <p className="text-sm">
        <Link href="/login">Log in</Link> to see your orders.
      </p>
    );
  }
  const orders = await listOrders();
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">Orders</h1>
      {orders.length === 0 ? (
        <p className="text-sm text-stone-600">You have not placed an order yet.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <Link href={`/orders/${order.id}`} className="font-medium">
                  {order.orderNumber}
                </Link>
                <p className="text-sm text-stone-500">{order.saga.state}</p>
              </div>
              <div className="flex items-center gap-3">
                <Money amount={order.pricing.grandTotal} currency={order.currency} />
                <StatusBadge status={order.status} paymentStatus={order.payment.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
