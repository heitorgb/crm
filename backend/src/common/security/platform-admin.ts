export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPlatformAdminEmail(
  email: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.includes(normalizeEmail(email));
}
