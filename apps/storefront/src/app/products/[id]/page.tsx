import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/molecules/product-card";
import { currentUser, getProduct } from "@/server/data";

export default async function ProductPage({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (user === null) {
    return (
      <p className="text-sm">
        <Link href="/login">Log in</Link> to view this product.
      </p>
    );
  }
  const product = await getProduct(params.id);
  if (product === null) {
    notFound();
  }
  return (
    <div className="max-w-md">
      <ProductCard product={product} />
    </div>
  );
}
