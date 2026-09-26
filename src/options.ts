import { getSites, sessionExpiry, sessionKey, sessionPrefix } from './sessions';
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
    const timer = document.createElement('span');
    timer.dataset.sessionSite = site;
    info.append(label, timer);
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
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Require Sudoku';
    reset.setAttribute('aria-label', `Require Sudoku on ${site}`);
    reset.addEventListener('click', () => void resetSessions(site));
    item.append(reset);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void removeSite(site));
    item.append(remove);
    sitesList!.append(item);
  }
  await renderTimeLeft();
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

void chrome.storage.local.get({ difficulty: 'trivial', jumps: 10, unlockMinutes: 15 }).then((settings) => {
  difficulty.value = settings.difficulty;
  jumps.value = String(settings.jumps);
  unlockMinutes.value = String(settings.unlockMinutes);
});

async function renderTimeLeft() {
  const sites = await getSites();
  const sessions = await chrome.storage.local.get(sites.map(sessionKey));
  let active = 0;
  for (const timer of document.querySelectorAll<HTMLElement>('[data-session-site]')) {
    const remaining = Math.max(0, sessionExpiry(sessions[sessionKey(timer.dataset.sessionSite!)]) - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    timer.textContent = remaining > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left` : 'Sudoku required';
    if (remaining > 0) active++;
  }
  timeLeft!.textContent = active ? `${active} website${active === 1 ? '' : 's'} with scrolling time left` : 'No active scrolling time';
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

async function resetSessions(site?: string) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'reset-session', site });
    if (!response?.ok) throw new Error('Reset failed');
    saved!.textContent = site ? `Sudoku required on ${site}.` : 'Sudoku required on all watched websites.';
    await renderTimeLeft();
  } catch (error) {
    console.error("Sudon't: failed to reset session", error);
    saved!.textContent = 'Failed to reset session.';
  }
}
resetSession.addEventListener('click', () => void resetSessions());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sites) void renderSites();
  else if (Object.keys(changes).some(key => key.startsWith(sessionPrefix))) void renderTimeLeft();
});
