const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(amountMinor: number, currency: string): string {
  if (currency === "USD") {
    return currencyFormat.format(amountMinor / 100);
  }
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}
