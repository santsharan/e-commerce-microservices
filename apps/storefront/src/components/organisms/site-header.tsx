"use client";

import Link from "next/link";
import { logoutAction } from "@/server/actions";
import type { SessionUser } from "@/lib/types";
import { cartLabel } from "@/lib/cart";
import { useLocalCart } from "@/components/organisms/use-local-cart";

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const cart = useLocalCart();
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Commerce Flow
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/cart">Cart ({cartLabel(cart.lines)})</Link>
          {user === null ? (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/register">Create account</Link>
            </>
          ) : (
            <>
              <Link href="/orders">Orders</Link>
              <Link href="/account">{user.email}</Link>
              <form action={logoutAction}>
                <button type="submit" className="text-stone-600">
                  Log out
                </button>
              </form>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
