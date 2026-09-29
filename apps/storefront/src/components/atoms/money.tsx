import { formatMoney } from "@/lib/money";

export function Money({ amount, currency }: { amount: number; currency: string }) {
  return <span>{formatMoney(amount, currency)}</span>;
}
