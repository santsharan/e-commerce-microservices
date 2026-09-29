import Link from "next/link";
import { ProductGrid } from "@/components/organisms/product-grid";
import { currentUser, listProducts } from "@/server/data";

export default async function HomePage() {
  const user = await currentUser();
  if (user === null) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">Shop the catalog</h1>
        <p className="max-w-xl text-stone-600">
          Create an account to browse products and place an order. Payment is authorized as part of
          the order. This store does not collect card numbers.
        </p>
        <Link
          href="/register"
          className="inline-block rounded-md bg-stone-900 px-4 py-2 text-sm text-white"
        >
          Create account
        </Link>
      </section>
    );
  }
  const products = await listProducts();
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold">Catalog</h1>
      <ProductGrid products={products} />
    </section>
  );
}
