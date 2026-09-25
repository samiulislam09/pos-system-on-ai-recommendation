import { REVIEWER_ROLES } from "./vendor-notifications.service";

describe("REVIEWER_ROLES", () => {
  it("includes the roles that review supplier uploads and excludes the rest", () => {
    expect([...REVIEWER_ROLES].sort()).toEqual(
      ["INVENTORY_MANAGER", "MANAGER", "ORGANIZATION_ADMIN", "STORE_MANAGER", "SUPER_ADMIN"].sort(),
    );
  });
});
