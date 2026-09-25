export {};
const stateKey = 'scrollSession';
const alarmName = 'scroll-session-expired';
const extraTimeLogKey = 'extraTimeLog';
const extraTimeLogLimit = 200;
const maxExtraMinutes = 60;
const sitesKey = 'sites';
const defaultSites = ['youtube.com', 'reddit.com'];
const contentScriptId = 'dontscroll-gate';

async function getSites(): Promise<string[]> {
  const { [sitesKey]: sites } = await chrome.storage.local.get({ [sitesKey]: defaultSites });
  return Array.isArray(sites) && sites.every(site => typeof site === 'string') ? sites : defaultSites;
}
function isBlockedUrl(url: string | undefined, sites: string[]): boolean {
  try {
    const parsed = new URL(url ?? '');
    return /^https?:$/.test(parsed.protocol) && sites.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
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
async function guardAllTabs() {
  const { scrollSession } = await chrome.storage.local.get({ scrollSession: { unlockedUntil: 0 } });
  if (scrollSession.unlockedUntil > Date.now()) {
    await chrome.alarms.create(alarmName, { when: scrollSession.unlockedUntil + 500 });
    return;
  }
  const sites = await getSites();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id !== undefined && isBlockedUrl(tab.url, sites)).map(tab => chrome.tabs.sendMessage(tab.id!, { type: 'show-sudoku' }).catch(error => console.error("Sudon't: failed to message tab", tab.id, error))));
}
async function logExtraTimeGrant(minutes: number, reason: string, website?: string) {
  const { [extraTimeLogKey]: log } = await chrome.storage.local.get({ [extraTimeLogKey]: [] as unknown[] });
  const entry = { timestamp: Date.now(), minutes, reason, website };
  const updated = [...(Array.isArray(log) ? log : []), entry].slice(-extraTimeLogLimit);
  await chrome.storage.local.set({ [extraTimeLogKey]: updated });
}
async function unlock(extra?: number, reason?: string, website?: string) {
  if (extra !== undefined && (!Number.isInteger(extra) || extra < 1 || extra > maxExtraMinutes || typeof reason !== 'string' || reason.trim().length < 80)) throw new Error('Invalid extra time request');
  const settings = await chrome.storage.local.get({ unlockMinutes: 15, scrollSession: { unlockedUntil: 0 } });
  const duration = Math.max(1, Math.min(240, Number(settings.unlockMinutes) || 15));
  const base = settings.scrollSession.unlockedUntil > Date.now() ? settings.scrollSession.unlockedUntil : Date.now() + duration * 60_000;
  const unlockedUntil = base + (extra ?? 0) * 60_000;
  await chrome.storage.local.set({ [stateKey]: { unlockedUntil } });
  await chrome.alarms.create(alarmName, { when: unlockedUntil + 500 });
  if (extra !== undefined && reason !== undefined) await logExtraTimeGrant(extra, reason.trim(), website);
  return unlockedUntil;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['enter-site', 'sudoku-solved', 'reset-session', 'sites-changed'].includes(message?.type)) return false;
  const operation = async () => {
    const fromOptionsPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
    if (message.type === 'sites-changed') {
      if (!fromOptionsPage) return { ok: false };
      await syncContentScripts();
      await guardAllTabs();
      return { ok: true };
    }
    const sites = await getSites();
    const trusted = sender.id === chrome.runtime.id && (isBlockedUrl(sender.url, sites) || fromOptionsPage);
    if (!trusted) return { ok: false };
    if (message.type === 'reset-session') {
      await chrome.storage.local.set({ [stateKey]: { unlockedUntil: 0 } });
      await chrome.alarms.clear(alarmName);
      await guardAllTabs();
      return { ok: true };
    }
    const website = (() => { try { return new URL(sender.url ?? '').hostname; } catch { return undefined; } })();
    return { ok: true, unlockedUntil: await unlock(message.minutes, message.reason, website) };
  };
  void operation().then(respond).catch(error => { console.error("Sudon't: message handler failed", message?.type, error); respond({ ok: false }); });
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
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName) void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error)); });
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage().catch(error => console.error("Sudon't: failed to open options page", error)));
void syncContentScripts().catch(error => console.error("Sudon't: syncContentScripts failed", error));
void guardAllTabs().catch(error => console.error("Sudon't: guardAllTabs failed", error));
