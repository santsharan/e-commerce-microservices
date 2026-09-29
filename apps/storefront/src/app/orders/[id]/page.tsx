import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/organisms/order-detail";
import { currentUser, loadOrder } from "@/server/data";

export default async function OrderPage({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (user === null) {
    return (
      <p className="text-sm">
        <Link href="/login">Log in</Link> to view this order.
      </p>
    );
  }
  const found = await loadOrder(params.id);
  if (found === null) {
    notFound();
  }
  return <OrderDetail initial={found.order} etag={found.etag} />;
}
