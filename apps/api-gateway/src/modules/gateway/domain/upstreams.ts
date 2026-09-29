import { defaultPorts } from "@commerce-flow/config";

export interface Upstreams {
  identity: string;
  catalog: string;
  inventory: string;
  order: string;
}

export function upstreams(host: string): Upstreams {
  const base = host.replace(/\/$/, "");
  return {
    identity: `${base}:${defaultPorts["identity-service"]}`,
    catalog: `${base}:${defaultPorts["catalog-service"]}`,
    inventory: `${base}:${defaultPorts["inventory-service"]}`,
    order: `${base}:${defaultPorts["order-service"]}`,
  };
}

export function upstreamFor(path: string, targets: Upstreams): string | undefined {
  const normalized = path.split("?")[0] ?? path;
  if (normalized.startsWith("/api/v1/users")) {
    return targets.identity;
  }
  if (normalized.startsWith("/api/v1/products") || normalized.startsWith("/api/v1/categories")) {
    return targets.catalog;
  }
  if (normalized.startsWith("/api/v1/inventory")) {
    return targets.inventory;
  }
  if (normalized.startsWith("/api/v1/orders")) {
    return targets.order;
  }
  return undefined;
}
