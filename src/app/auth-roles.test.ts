import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";

import { canReviewClaims, getUserAppRole, isInternalAppRole } from "./auth-roles";

function userWithMetadata(appRole?: unknown, userRole?: unknown): User {
  return {
    app_metadata: appRole === undefined ? {} : { app_role: appRole },
    user_metadata: userRole === undefined ? {} : { app_role: userRole },
  } as User;
}

describe("auth roles", () => {
  it("prefers app metadata roles over user metadata roles", () => {
    expect(getUserAppRole(userWithMetadata("ADMIN", "REVIEWER"))).toBe("ADMIN");
  });

  it("falls back to PUBLIC when no supported role is present", () => {
    expect(getUserAppRole(userWithMetadata("OWNER"))).toBe("PUBLIC");
    expect(getUserAppRole(null)).toBe("PUBLIC");
  });

  it("separates internal access and claim review permissions", () => {
    expect(isInternalAppRole("RESEARCHER")).toBe(true);
    expect(isInternalAppRole("PUBLIC")).toBe(false);
    expect(canReviewClaims("REVIEWER")).toBe(true);
    expect(canReviewClaims("RESEARCHER")).toBe(false);
  });
});
