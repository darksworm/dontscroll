export const defaultSites = ['youtube.com', 'reddit.com'];
export const sessionPrefix = 'scrollSession:';
export const alarmPrefix = 'scroll-session-expired:';

export async function getSites(): Promise<string[]> {
  const { sites } = await chrome.storage.local.get({ sites: defaultSites });
  return Array.isArray(sites) && sites.every(site => typeof site === 'string') ? sites : defaultSites;
}

export function resolveSite(url: string | undefined, sites: string[]): string | undefined {
  try {
    const parsed = new URL(url ?? '');
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    return sites.filter(site => parsed.hostname === site || parsed.hostname.endsWith(`.${site}`)).sort((left, right) => right.length - left.length)[0];
  } catch { return undefined; }
}

export function sessionKey(site: string): string {
  return `${sessionPrefix}${site}`;
}

export function sessionExpiry(session: unknown): number {
  if (!session || typeof session !== 'object' || !('unlockedUntil' in session)) return 0;
  const expiry = session.unlockedUntil;
  return typeof expiry === 'number' && Number.isFinite(expiry) && expiry > 0 ? expiry : 0;
}
