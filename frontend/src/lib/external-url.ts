export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
