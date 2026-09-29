import { describe, expect, it } from "vitest";
import { Permission, Role, ServiceScope, hasPermission } from "./index.js";

describe("auth contracts", () => {
  it("keeps the role and permission vocabulary stable", () => {
    expect(Object.values(Role)).toEqual(["customer", "admin", "support", "service"]);
    expect(Permission.ordersCancel).toBe("orders:cancel");
    expect(ServiceScope.inventoryReserve).toBe("inventory.reserve");
  });

  it("checks an explicit grant list", () => {
    expect(hasPermission([Permission.ordersRead], Permission.ordersRead)).toBe(true);
    expect(hasPermission([Permission.ordersRead], Permission.ordersWrite)).toBe(false);
  });
});
