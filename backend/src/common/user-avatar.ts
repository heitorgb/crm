export function userAvatarUrl(membershipId: string, avatarUpdatedAt: Date | null): string | null {
  return avatarUpdatedAt
    ? `/members/${membershipId}/avatar?v=${avatarUpdatedAt.getTime()}`
    : null;
}
