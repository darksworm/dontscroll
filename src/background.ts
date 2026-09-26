import { alarmPrefix, getSites, resolveSite, sessionExpiry, sessionKey, sessionPrefix } from './sessions';

let operations: Promise<unknown> = Promise.resolve();
function enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = operations.then(operation);
  operations = result.catch(() => {});
  return result;
}
const extraTimeLogKey = 'extraTimeLog';
const extraTimeLogLimit = 200;
const maxExtraMinutes = 60;
const contentScriptId = 'dontscroll-gate';

async function reconcileSessions() {
  const sites = await getSites();
  const stored = await chrome.storage.local.get(null);
  if (stored.scrollSession !== undefined) {
    const unlockedUntil = sessionExpiry(stored.scrollSession);
    if (unlockedUntil > Date.now()) {
      const migrated = Object.fromEntries(sites.filter(site => stored[sessionKey(site)] === undefined).map(site => [sessionKey(site), { unlockedUntil }]));
      await chrome.storage.local.set(migrated);
      Object.assign(stored, migrated);
    }
    await chrome.storage.local.remove('scrollSession');
  }
  await chrome.alarms.clear('scroll-session-expired');
  const staleKeys = Object.keys(stored).filter(key => key.startsWith(sessionPrefix) && !sites.includes(key.slice(sessionPrefix.length)));
  if (staleKeys.length) await chrome.storage.local.remove(staleKeys);
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith(alarmPrefix) && !sites.includes(alarm.name.slice(alarmPrefix.length))) await chrome.alarms.clear(alarm.name);
  }
  for (const site of sites) {
    const expiry = sessionExpiry(stored[sessionKey(site)]);
    if (expiry > Date.now()) await chrome.alarms.create(`${alarmPrefix}${site}`, { when: expiry + 500 });
    else await chrome.alarms.clear(`${alarmPrefix}${site}`);
  }
}
const initialized = enqueue(reconcileSessions);
function sitePatterns(sites: string[]): string[] {
  return sites.flatMap(host => [`*://${host}/*`, `*://*.${host}/*`]);
}
async function getPermittedSites(): Promise<string[]> {
  const sites = await getSites();
  const permitted = await Promise.all(sites.map(async site => (await chrome.permissions.contains({ origins: sitePatterns([site]) })) ? site : null));
  return permitted.filter((site): site is string => site !== null);
}
async function syncBadge() {
  const sites = await getSites();
  const permitted = await getPermittedSites();
  const missing = sites.length - permitted.length;
  await chrome.action.setBadgeText({ text: missing > 0 ? String(missing) : '' });
  if (missing > 0) await chrome.action.setBadgeBackgroundColor({ color: '#a3453b' });
  await chrome.action.setTitle({ title: missing > 0 ? `Sudon't: ${missing} site${missing === 1 ? '' : 's'} need access` : "Sudon't" });
}
async function syncContentScripts() {
  await syncBadge().catch(error => console.error("Sudon't: failed to sync badge", error));
  const matches = sitePatterns(await getPermittedSites());
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] });
  if (matches.length === 0) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] });
    return;
  }
  const script: chrome.scripting.RegisteredContentScript = { id: contentScriptId, js: ['content.js'], matches, runAt: 'document_start', persistAcrossSessions: true };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}
async function guardAllTabs(onlySite?: string) {
  await initialized;
  const sites = await getSites();
  const sessions = await chrome.storage.local.get(sites.map(sessionKey));
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => {
    const site = resolveSite(tab.url, sites);
    return tab.id !== undefined && site !== undefined && (!onlySite || site === onlySite) && sessionExpiry(sessions[sessionKey(site)]) <= Date.now();
  }).map(tab => chrome.tabs.sendMessage(tab.id!, { type: 'show-sudoku' }).catch(error => console.error("Sudon't: failed to message tab", tab.id, error))));
}
async function logExtraTimeGrant(minutes: number, reason: string, website?: string) {
  const { [extraTimeLogKey]: log } = await chrome.storage.local.get({ [extraTimeLogKey]: [] as unknown[] });
  const entry = { timestamp: Date.now(), minutes, reason, website };
  const updated = [...(Array.isArray(log) ? log : []), entry].slice(-extraTimeLogLimit);
  await chrome.storage.local.set({ [extraTimeLogKey]: updated });
}
async function unlock(website: string, extra?: number, reason?: string) {
  if (extra !== undefined && (!Number.isInteger(extra) || extra < 1 || extra > maxExtraMinutes || typeof reason !== 'string' || reason.trim().length < 80)) throw new Error('Invalid extra time request');
  const key = sessionKey(website);
  const settings = await chrome.storage.local.get({ unlockMinutes: 15, [key]: { unlockedUntil: 0 } });
  const duration = Math.max(1, Math.min(240, Number(settings.unlockMinutes) || 15));
  const expiry = sessionExpiry(settings[key]);
  const base = expiry > Date.now() ? expiry : Date.now() + duration * 60_000;
  const unlockedUntil = base + (extra ?? 0) * 60_000;
  await chrome.storage.local.set({ [key]: { unlockedUntil } });
  await chrome.alarms.create(`${alarmPrefix}${website}`, { when: unlockedUntil + 500 });
  if (extra !== undefined && reason !== undefined) await logExtraTimeGrant(extra, reason.trim(), website);
  return unlockedUntil;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['enter-site', 'sudoku-solved', 'reset-session', 'sites-changed'].includes(message?.type)) return false;
  const operation = async () => {
    await initialized;
    if (sender.id !== chrome.runtime.id) return { ok: false };
    const senderUrl = new URL(sender.url ?? chrome.runtime.getURL(''));
    const fromOptionsPage = senderUrl.href.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
    if (message.type === 'sites-changed') {
      if (!fromOptionsPage) return { ok: false };
      await reconcileSessions();
      await syncContentScripts();
      await guardAllTabs();
      return { ok: true };
    }
    const sites = await getSites();
    if (message.type === 'reset-session') {
      if (!fromOptionsPage || (message.site !== undefined && !sites.includes(message.site))) return { ok: false };
      const targets = message.site === undefined ? sites : [message.site as string];
      await chrome.storage.local.remove(targets.map(sessionKey));
      await Promise.all(targets.map(site => chrome.alarms.clear(`${alarmPrefix}${site}`)));
      await guardAllTabs(message.site);
      return { ok: true };
    }
    const fromBlockedPage = senderUrl.href.split(/[?#]/)[0] === chrome.runtime.getURL('blocked.html');
    const website = resolveSite(fromBlockedPage ? senderUrl.searchParams.get('target') ?? undefined : sender.url, sites);
    if (!website) return { ok: false };
    return { ok: true, unlockedUntil: await unlock(website, message.type === 'enter-site' ? message.minutes : undefined, message.reason) };
  };
  void enqueue(operation).then(respond).catch(error => { console.error("Sudon't: message handler failed", message?.type, error); respond({ ok: false }); });
  return true;
});
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.status === 'complete') void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error)); });
chrome.tabs.onActivated.addListener(() => void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error)));
async function showWelcome() {
  console.log("Sudon't: opening welcome page");
  await chrome.storage.local.set({ welcomeShown: true });
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') }).catch(error => {
    console.error("Sudon't: failed to open welcome page", error);
    return undefined;
  });
  if (tab) console.log("Sudon't: welcome page opened", tab.id);
}
async function showWelcomeIfNeeded() {
  const { welcomeShown } = await chrome.storage.local.get({ welcomeShown: false });
  if (welcomeShown) return;
  await showWelcome();
}
chrome.runtime.onStartup.addListener(() => {
  console.log("Sudon't: onStartup");
  void syncContentScripts().catch(error => console.error("Sudon't: syncContentScripts failed", error));
  void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error));
  void showWelcomeIfNeeded().catch(error => console.error("Sudon't: showWelcomeIfNeeded failed", error));
});
chrome.runtime.onInstalled.addListener(details => {
  console.log("Sudon't: onInstalled", details.reason);
  void syncContentScripts().catch(error => console.error("Sudon't: syncContentScripts failed", error));
  void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error));
  if (details.reason === 'install') void showWelcome().catch(error => console.error("Sudon't: showWelcome failed", error));
  else void showWelcomeIfNeeded().catch(error => console.error("Sudon't: showWelcomeIfNeeded failed", error));
});
chrome.permissions.onAdded.addListener(() => {
  void syncContentScripts().catch(error => console.error("Sudon't: syncContentScripts failed", error));
  void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error));
});
chrome.permissions.onRemoved.addListener(() => {
  void syncContentScripts().catch(error => console.error("Sudon't: syncContentScripts failed", error));
  void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error));
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name.startsWith(alarmPrefix)) void guardAllTabs(alarm.name.slice(alarmPrefix.length)).catch(error => console.error("Sudon't: guardAllTabs failed", error)); });
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage().catch(error => console.error("Sudon't: failed to open options page", error)));
void syncContentScripts().catch(error => console.error("Sudon't: syncContentScripts failed", error));
void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error));
