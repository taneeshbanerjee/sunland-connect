export type AppRole = "super_admin" | "president" | "board_member" | "resident";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  president: "President",
  board_member: "Board Member",
  resident: "Resident",
};

export const ROLE_BLURB: Record<AppRole, string> = {
  super_admin: "Full control of the portal, including creating other admins.",
  president: "Supreme committee powers — announcements, dues and submissions.",
  board_member: "Can publish announcements and view residency records.",
  resident: "Can view their own dues, submissions and announcements.",
};

export function highestRole(roles: AppRole[]): AppRole {
  const order: AppRole[] = ["super_admin", "president", "board_member", "resident"];
  return order.find((r) => roles.includes(r)) ?? "resident";
}

export function isCommittee(roles: AppRole[]) {
  return roles.some((r) => r === "super_admin" || r === "president" || r === "board_member");
}

export function isElevated(roles: AppRole[]) {
  return roles.some((r) => r === "super_admin" || r === "president");
}
