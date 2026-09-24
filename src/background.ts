const stateKey = 'scrollSession';
const alarmName = 'scroll-session-expired';
const extraTimeLogKey = 'extraTimeLog';
const extraTimeLogLimit = 200;
const maxExtraMinutes = 60;

function isBlockedUrl(url?: string): boolean {
  try {
    const parsed = new URL(url ?? '');
    return /^https?:$/.test(parsed.protocol) && ['youtube.com', 'reddit.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
async function guardAllTabs() {
  const { scrollSession } = await chrome.storage.local.get({ scrollSession: { unlockedUntil: 0 } });
  if (scrollSession.unlockedUntil > Date.now()) {
    await chrome.alarms.create(alarmName, { when: scrollSession.unlockedUntil + 500 });
    return;
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id !== undefined && isBlockedUrl(tab.url)).map(tab => chrome.tabs.sendMessage(tab.id!, { type: 'show-sudoku' }).catch(() => undefined)));
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
  if (!['enter-site', 'sudoku-solved', 'reset-session'].includes(message?.type)) return false;
  const trusted = sender.id === chrome.runtime.id && (isBlockedUrl(sender.url) || sender.url?.startsWith(chrome.runtime.getURL('')));
  if (!trusted) return false;
  const operation = async () => {
    if (message.type === 'reset-session') {
      await chrome.storage.local.set({ [stateKey]: { unlockedUntil: 0 } });
      await chrome.alarms.clear(alarmName);
      await guardAllTabs();
      return { ok: true };
    }
    const website = (() => { try { return new URL(sender.url ?? '').hostname; } catch { return undefined; } })();
    return { ok: true, unlockedUntil: await unlock(message.minutes, message.reason, website) };
  };
  void operation().then(respond).catch(() => respond({ ok: false }));
  return true;
});
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.status === 'complete') void guardAllTabs(); });
chrome.tabs.onActivated.addListener(() => void guardAllTabs());
chrome.runtime.onStartup.addListener(() => void guardAllTabs());
chrome.runtime.onInstalled.addListener(() => void guardAllTabs());
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName) void guardAllTabs(); });
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
void guardAllTabs();
