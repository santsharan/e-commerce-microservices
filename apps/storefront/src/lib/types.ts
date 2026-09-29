export interface SessionUser {
  id: string;
  email: string;
  roles: string[];
}

export interface Product {
  id: string;
  name: string;
  description: string;
  status: string;
  variants: ProductVariant[];
}

export interface ProductVariant {
  sku: string;
  name: string;
  price: { amount: number; currency: string };
}

export interface ProductPage {
  items: Product[];
  page: number;
  limit: number;
  total: number;
}

export interface OrderItem {
  productId: string;
  sku: string;
  nameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  items: OrderItem[];
  pricing: { grandTotal: number };
  payment: { status: string; paymentId?: string };
  saga: { state: string };
  version: number;
}

export interface OrderPage {
  items: Order[];
  page: number;
  total: number;
}

export interface GatewayFailure {
  status: number;
  code: string;
  message: string;
}

export function readFailure(status: number, body: unknown): GatewayFailure {
  if (isRecord(body) && isRecord(body["error"])) {
    const error = body["error"];
    const code = typeof error["code"] === "string" ? error["code"] : "REQUEST_FAILED";
    const message = typeof error["message"] === "string" ? error["message"] : "Request failed";
    return { status, code, message };
  }
  return { status, code: "REQUEST_FAILED", message: "Request failed" };
}

export function orderStatusLabel(status: string, paymentStatus: string): string {
  if (status === "confirmed" && paymentStatus === "authorized") {
    return "Paid";
  }
  if (status === "failed") {
    return "Payment failed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "cancelling") {
    return "Cancelling";
  }
  return "Processing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
