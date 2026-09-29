import { Permission, Role } from "@commerce-flow/auth";

/**
 * Identity owns this table. The shared auth package only names the roles and permissions.
 * Self-registration always stores `customer`. `service` has no user permissions;
 * service scopes are a separate token and are not issued here.
 *
 * The architecture lists the roles and the permission strings, but not this mapping.
 * customer can shop and manage their own orders.
 * support can read catalog, orders, and inventory, and cancel an order.
 * admin receives every user permission.
 */
export const roleGrants: Record<Role, readonly Permission[]> = {
  customer: [
    Permission.productsRead,
    Permission.ordersRead,
    Permission.ordersWrite,
    Permission.ordersCancel,
  ],
  support: [
    Permission.productsRead,
    Permission.ordersRead,
    Permission.ordersCancel,
    Permission.inventoryRead,
  ],
  admin: Object.values(Permission),
  service: [],
};

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const granted: Permission[] = [];
  const seen = new Set<Permission>();
  for (const role of roles) {
    for (const permission of roleGrants[role]) {
      if (!seen.has(permission)) {
        seen.add(permission);
        granted.push(permission);
      }
    }
  }
  return granted;
}
