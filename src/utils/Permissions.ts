export const Permissions = {
  default: 0,
  builder: 1,
  moderator: 2,
  admin: 4,
};

export function mcRankToPermission(rank: string): number {
  switch (rank) {
    case "Owner":
    case "Administrator":
      return Permissions.admin;
    case "Moderator":
      return Permissions.moderator;
    case "Developer":
    case "Supporter":
    case "Architect":
      return Permissions.builder;
    default:
      return Permissions.default;
  }
}
