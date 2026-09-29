import { Permission, Role } from "@commerce-flow/auth";
import { describe, expect, it } from "vitest";
import { permissionsForRoles, roleGrants } from "./grants.js";

describe("role grants", () => {
  it("gives customers shopping permissions and keeps support off catalog writes", () => {
    expect(roleGrants.customer).toEqual([
      Permission.productsRead,
      Permission.ordersRead,
      Permission.ordersWrite,
      Permission.ordersCancel,
    ]);
    expect(roleGrants.support).not.toContain(Permission.productsWrite);
    expect(roleGrants.support).toContain(Permission.inventoryRead);
    expect(roleGrants.admin).toEqual(Object.values(Permission));
    expect(roleGrants.service).toEqual([]);
  });

  it("unions roles without duplicating a permission", () => {
    expect(permissionsForRoles([Role.customer, Role.support])).toEqual([
      Permission.productsRead,
      Permission.ordersRead,
      Permission.ordersWrite,
      Permission.ordersCancel,
      Permission.inventoryRead,
    ]);
  });
});
