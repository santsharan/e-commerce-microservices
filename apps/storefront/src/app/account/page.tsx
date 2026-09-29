import Link from "next/link";
import { currentUser } from "@/server/data";

export default async function AccountPage() {
  const user = await currentUser();
  if (user === null) {
    return (
      <p className="text-sm">
        <Link href="/login">Log in</Link> to see your account.
      </p>
    );
  }
  return (
    <section className="space-y-2">
      <h1 className="text-3xl font-semibold">Account</h1>
      <p>{user.email}</p>
      <p className="text-sm text-stone-600">Roles: {user.roles.join(", ")}</p>
    </section>
  );
}
