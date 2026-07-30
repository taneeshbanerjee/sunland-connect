export type AppRole = "super_admin" | "treasurer" | "president" | "board_member" | "resident";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  treasurer: "Treasurer",
  president: "President",
  board_member: "Board Member",
  resident: "Resident",
};

export const ROLE_BLURB: Record<AppRole, string> = {
  super_admin: "Full control of the portal, including creating and transferring admin roles.",
  treasurer: "Second Super Admin — full control of the portal, finances and residency records.",
  president: "Supreme committee powers — announcements, dues, submissions and receipts.",
  board_member: "Can publish announcements and view residency records.",
  resident: "Can view their own dues, receipts, submissions and announcements.",
};

/** Roles that can be granted / transferred from the console. */
export const MANAGED_ROLES: AppRole[] = ["super_admin", "treasurer", "president", "board_member"];

const ORDER: AppRole[] = ["super_admin", "treasurer", "president", "board_member", "resident"];

export function highestRole(roles: AppRole[]): AppRole {
  return ORDER.find((r) => roles.includes(r)) ?? "resident";
}

export function isCommittee(roles: AppRole[]) {
  return roles.some(
    (r) => r === "super_admin" || r === "treasurer" || r === "president" || r === "board_member",
  );
}

/** Can manage dues, submissions, receipts and audit/monitoring. */
export function isElevated(roles: AppRole[]) {
  return roles.some((r) => r === "super_admin" || r === "treasurer" || r === "president");
}

/** Full control: Super Admin and Treasurer only. */
export function isSupreme(roles: AppRole[]) {
  return roles.some((r) => r === "super_admin" || r === "treasurer");
}
