import { orderStatusLabel } from "@/lib/types";

export function StatusBadge({ status, paymentStatus }: { status: string; paymentStatus: string }) {
  const label = orderStatusLabel(status, paymentStatus);
  const tone =
    label === "Paid"
      ? "bg-emerald-100 text-emerald-900"
      : label === "Payment failed" || label === "Cancelled"
        ? "bg-rose-100 text-rose-900"
        : "bg-amber-100 text-amber-900";
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}
