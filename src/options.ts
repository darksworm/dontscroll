export {};
const difficulty = document.querySelector<HTMLSelectElement>('#difficulty');
const jumps = document.querySelector<HTMLInputElement>('#jumps');
const unlockMinutes = document.querySelector<HTMLInputElement>('#unlock-minutes');
const save = document.querySelector<HTMLButtonElement>('#save');
const resetSession = document.querySelector<HTMLButtonElement>('#reset-session');
const timeLeft = document.querySelector<HTMLElement>('#time-left');
const saved = document.querySelector<HTMLElement>('#saved');
const extraTimeLog = document.querySelector<HTMLUListElement>('#extra-time-log');
const sitesList = document.querySelector<HTMLUListElement>('#sites');
const newSite = document.querySelector<HTMLInputElement>('#new-site');
const addSite = document.querySelector<HTMLButtonElement>('#add-site');
const siteError = document.querySelector<HTMLElement>('#site-error');
const welcomeBanner = document.querySelector<HTMLElement>('#welcome-banner');
const allowAll = document.querySelector<HTMLButtonElement>('#allow-all');

if (!difficulty || !jumps || !unlockMinutes || !save || !resetSession || !timeLeft || !saved || !extraTimeLog || !sitesList || !newSite || !addSite || !siteError || !welcomeBanner || !allowAll) throw new Error('Settings page is missing required elements');

const defaultSites = ['youtube.com', 'reddit.com'];

function normalizeSite(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
    return hostname.includes('.') ? hostname : null;
  } catch { return null; }
}
function sitePatterns(site: string): string[] {
  return [`*://${site}/*`, `*://*.${site}/*`];
}
function allSitePatterns(sites: string[]): string[] {
  return sites.flatMap(sitePatterns);
}
async function getSites(): Promise<string[]> {
  const { sites } = await chrome.storage.local.get({ sites: defaultSites });
  return Array.isArray(sites) && sites.every(site => typeof site === 'string') ? sites : defaultSites;
}
async function grantSite(site: string) {
  const granted = await chrome.permissions.request({ origins: sitePatterns(site) }).catch(error => {
    console.error("Sudon't: permissions.request failed", error);
    return false;
  });
  if (!granted) {
    siteError!.textContent = `Permission was not granted for ${site}.`;
    return;
  }
  await chrome.runtime.sendMessage({ type: 'sites-changed' }).catch(error => console.error("Sudon't: failed to notify background", error));
  await renderSites();
}
let cachedMissingSites: string[] = [];
async function renderWelcomeBanner(sites: string[]) {
  const missing = await Promise.all(sites.map(async site => (await chrome.permissions.contains({ origins: sitePatterns(site) })) ? null : site));
  const missingSites = missing.filter((site): site is string => site !== null);
  cachedMissingSites = missingSites;
  welcomeBanner!.style.display = missingSites.length > 0 ? 'block' : 'none';
  return missingSites;
}
async function renderSites() {
  const sites = await getSites();
  const missingSites = await renderWelcomeBanner(sites);
  sitesList!.textContent = '';
  if (sites.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No websites configured.';
    sitesList!.append(empty);
    return;
  }
  for (const site of sites) {
    const item = document.createElement('li');
    const granted = !missingSites.includes(site);
    if (!granted) item.className = 'inactive';
    const info = document.createElement('div');
    info.className = 'site-info';
    const label = document.createElement('span');
    label.textContent = site;
    info.append(label);
    if (!granted) {
      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = 'Not active, access needed';
      info.append(status);
    }
    item.append(info);
    if (!granted) {
      const grant = document.createElement('button');
      grant.type = 'button';
      grant.textContent = 'Grant access';
      grant.addEventListener('click', () => void grantSite(site));
      item.append(grant);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void removeSite(site));
    item.append(remove);
    sitesList!.append(item);
  }
}
async function removeSite(site: string) {
  const sites = await getSites();
  await chrome.permissions.remove({ origins: sitePatterns(site) }).catch(error => console.error("Sudon't: permissions.remove failed", error));
  await chrome.storage.local.set({ sites: sites.filter(existing => existing !== site) });
  await chrome.runtime.sendMessage({ type: 'sites-changed' }).catch(error => console.error("Sudon't: failed to notify background", error));
  await renderSites();
}
addSite.addEventListener('click', () => {
  siteError!.textContent = '';
  const site = normalizeSite(newSite.value);
  if (!site) {
    siteError!.textContent = 'Enter a valid website, like example.com.';
    return;
  }
  void chrome.permissions.request({ origins: sitePatterns(site) }).catch(error => {
    console.error("Sudon't: permissions.request failed", error);
    return false;
  }).then(async granted => {
    if (!granted) {
      siteError!.textContent = 'Permission was not granted for that site.';
      return;
    }
    const sites = await getSites();
    if (sites.includes(site)) {
      siteError!.textContent = `${site} is already on the list.`;
      return;
    }
    await chrome.storage.local.set({ sites: [...sites, site] });
    await chrome.runtime.sendMessage({ type: 'sites-changed' }).catch(error => console.error("Sudon't: failed to notify background", error));
    newSite.value = '';
    await renderSites();
  });
});
void renderSites();

allowAll.addEventListener('click', () => {
  siteError!.textContent = '';
  if (cachedMissingSites.length === 0) return;
  void chrome.permissions.request({ origins: allSitePatterns(cachedMissingSites) }).catch(error => {
    console.error("Sudon't: permissions.request failed", error);
    return false;
  }).then(async granted => {
    if (!granted) {
      siteError!.textContent = 'Permission was not granted.';
      return;
    }
    await chrome.runtime.sendMessage({ type: 'sites-changed' }).catch(error => console.error("Sudon't: failed to notify background", error));
    await renderSites();
  });
});

chrome.permissions.onAdded?.addListener(() => void renderSites());
chrome.permissions.onRemoved?.addListener(() => void renderSites());

type ExtraTimeEntry = { timestamp: number; minutes: number; reason: string; website?: string };

async function renderExtraTimeLog() {
  const { extraTimeLog: log } = await chrome.storage.local.get({ extraTimeLog: [] as ExtraTimeEntry[] });
  const entries = Array.isArray(log) ? log : [];
  extraTimeLog!.textContent = '';
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No extra time granted yet.';
    extraTimeLog!.append(empty);
    return;
  }
  [...entries].reverse().forEach(entry => {
    const item = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${entry.website ?? 'unknown site'} · +${entry.minutes} min`;
    const text = document.createElement('div');
    text.textContent = entry.reason;
    item.append(meta, text);
    extraTimeLog!.append(item);
  });
}
void renderExtraTimeLog();

void chrome.storage.local.get({ difficulty: 'trivial', jumps: 10, unlockMinutes: 15, scrollSession: { unlockedUntil: 0 } }).then((settings) => {
  difficulty.value = settings.difficulty;
  jumps.value = String(settings.jumps);
  unlockMinutes.value = String(settings.unlockMinutes);
});

async function renderTimeLeft() {
  const { scrollSession } = await chrome.storage.local.get({ scrollSession: { unlockedUntil: 0 } });
  const remaining = Math.max(0, Number(scrollSession.unlockedUntil) - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  timeLeft!.textContent = remaining > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} of scrolling time left` : 'No active scrolling time';
}
void renderTimeLeft();
window.setInterval(() => void renderTimeLeft(), 1000);
window.setInterval(() => void renderExtraTimeLog(), 5000);

save.addEventListener('click', async () => {
  const jumpCount = Math.max(0, Math.min(19, Number(jumps.value) || 0));
  const minutes = Math.max(1, Math.min(240, Number(unlockMinutes.value) || 15));
  await chrome.storage.local.set({ difficulty: difficulty.value, jumps: jumpCount, unlockMinutes: minutes });
  jumps.value = String(jumpCount);
  unlockMinutes.value = String(minutes);
  saved.textContent = 'Settings saved.';
});

resetSession.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'reset-session' }).then(() => {
    saved.textContent = 'Sudoku required on the next blocked-site visit.';
  }).catch(error => {
    console.error("Sudon't: failed to reset session", error);
    saved.textContent = 'Failed to reset session.';
  });
});
