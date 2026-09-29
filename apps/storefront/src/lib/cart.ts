import { formatMoney } from "./money";

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  currency: string;
  quantity: number;
}

export const lineQuantityMax = 100;
export const cartLineMax = 20;

export function addLine(lines: readonly CartLine[], line: CartLine): CartLine[] {
  const existing = lines.find((item) => item.sku === line.sku);
  if (existing === undefined) {
    if (lines.length >= cartLineMax) {
      return [...lines];
    }
    return [...lines, { ...line, quantity: clamp(line.quantity) }];
  }
  return lines.map((item) =>
    item.sku === line.sku ? { ...item, quantity: clamp(item.quantity + line.quantity) } : item,
  );
}

export function setQuantity(lines: readonly CartLine[], sku: string, quantity: number): CartLine[] {
  if (quantity < 1) {
    return lines.filter((item) => item.sku !== sku);
  }
  return lines.map((item) => (item.sku === sku ? { ...item, quantity: clamp(quantity) } : item));
}

export function cartCurrency(lines: readonly CartLine[]): string | undefined {
  const first = lines[0];
  if (first === undefined) {
    return undefined;
  }
  return lines.every((item) => item.currency === first.currency) ? first.currency : undefined;
}

export function cartAmount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function cartLabel(lines: readonly CartLine[]): string {
  const currency = cartCurrency(lines);
  if (currency === undefined) {
    return lines.length === 0 ? formatMoney(0, "USD") : "Mixed currencies";
  }
  return formatMoney(cartAmount(lines), currency);
}

function clamp(quantity: number): number {
  return Math.max(1, Math.min(lineQuantityMax, quantity));
}
