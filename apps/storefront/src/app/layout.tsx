import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SessionWatch } from "@/components/organisms/session-watch";
import { SiteHeader } from "@/components/organisms/site-header";
import { accessExpiresAtMs } from "@/lib/session";
import { currentUser } from "@/server/data";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commerce Flow",
  description: "Shop, register, and place an order.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const access = cookies().get("cf_access")?.value;
  const expiresAt = sessionExpiry(user === null, access);
  return (
    <html lang="en">
      <body>
        <SessionWatch expiresAt={expiresAt} />
        <SiteHeader user={user} />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}

function sessionExpiry(signedOut: boolean, access: string | undefined): number | undefined {
  if (signedOut) {
    return undefined;
  }
  if (access === undefined) {
    return Date.now();
  }
  return accessExpiresAtMs(access) ?? Date.now();
}
