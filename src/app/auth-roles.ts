import type { User } from "@supabase/supabase-js";

import { type UserRole, userRoles } from "@/domain/ontology";

const internalRoles = new Set<UserRole>(["ADMIN", "RESEARCHER", "REVIEWER"]);

export function getUserAppRole(user: User | null): UserRole {
  if (!user) {
    return "PUBLIC";
  }

  return (
    parseAppRole(user.app_metadata.app_role) ??
    parseAppRole(user.user_metadata.app_role) ??
    "PUBLIC"
  );
}

export function isInternalAppRole(role: UserRole): boolean {
  return internalRoles.has(role);
}

export function canReviewClaims(role: UserRole): boolean {
  return role === "ADMIN" || role === "REVIEWER";
}

function parseAppRole(value: unknown): UserRole | undefined {
  return typeof value === "string" && userRoles.includes(value as UserRole)
    ? (value as UserRole)
    : undefined;
}
