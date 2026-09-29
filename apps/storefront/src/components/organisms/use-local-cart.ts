"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "@/lib/cart";

const storageKey = "cf-cart";
const eventName = "cf-cart";

export function useLocalCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    setLines(readCart());
    const onChange = () => setLines(readCart());
    window.addEventListener(eventName, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(eventName, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const replace = useCallback((next: CartLine[]) => {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setLines(next);
    window.dispatchEvent(new Event(eventName));
  }, []);

  return { lines, replace };
}

function readCart(): CartLine[] {
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
}

function isLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const line = value as Record<string, unknown>;
  return (
    typeof line["productId"] === "string" &&
    typeof line["sku"] === "string" &&
    typeof line["name"] === "string" &&
    typeof line["unitPrice"] === "number" &&
    typeof line["currency"] === "string" &&
    typeof line["quantity"] === "number"
  );
}
