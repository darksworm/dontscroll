import { mountGate } from './gate';
import { getSites, resolveSite, sessionExpiry, sessionKey } from './sessions';
import type { SudokuDifficulty } from './sudoku';

let overlay: HTMLElement | null = null;
let cleanup: (() => void) | undefined;
const pausedMedia = new Set<HTMLMediaElement>();
let checking = false;
let previousFocus: HTMLElement | null = null;
let expiryTimer: number | undefined;
let currentSite: string | undefined;
let checkAgain = false;

function scheduleExpiry(unlockedUntil: number) {
  window.clearTimeout(expiryTimer);
  const delay = unlockedUntil - Date.now();
  if (delay > 0) expiryTimer = window.setTimeout(() => void checkGate(), Math.min(delay + 250, 2_147_483_647));
}

function pause(event?: Event) {
  const elements = event?.target instanceof HTMLMediaElement ? [event.target] : document.querySelectorAll<HTMLMediaElement>('video, audio');
  for (const media of elements) {
    if (!media.paused) { pausedMedia.add(media); media.pause(); }
  }
}
let solvedHere = false;

function isolateKeys(event: KeyboardEvent) {
  if (!overlay) return;
  event.stopImmediatePropagation();
  const insideGate = event.composedPath().includes(overlay);
  if (!insideGate && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== 'Tab') event.preventDefault();
}
for (const type of ['keydown', 'keypress', 'keyup'] as const) window.addEventListener(type, isolateKeys, true);

function closeGate() {
  cleanup?.();
  overlay?.remove();
  overlay = null;
  solvedHere = false;
  document.removeEventListener('play', pause, true);
  previousFocus?.focus();
  if (document.visibilityState === 'visible') {
    for (const media of pausedMedia) if (media.isConnected) void media.play().catch(error => console.warn("Sudon't: failed to resume media playback", error));
  }
  pausedMedia.clear();
}
async function checkGate() {
  if (checking) { checkAgain = true; return; }
  checking = true;
  try {
    const site = resolveSite(location.href, await getSites());
    if (site !== currentSite) {
      window.clearTimeout(expiryTimer);
      if (overlay) closeGate();
      currentSite = site;
    }
    if (!site) return;
    const key = sessionKey(site);
    const settings = await chrome.storage.local.get({ difficulty: 'trivial', unlockMinutes: 15, jumps: 10, [key]: { unlockedUntil: 0 } });
    const unlockedUntil = sessionExpiry(settings[key]);
    if (unlockedUntil > Date.now()) {
      scheduleExpiry(unlockedUntil);
      if (overlay && !solvedHere) closeGate();
      return;
    }
    window.clearTimeout(expiryTimer);
    if (overlay && !solvedHere) return;
    if (overlay) closeGate();
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    document.documentElement.append(overlay);
    pause();
    document.addEventListener('play', pause, true);
    cleanup = mountGate(overlay.attachShadow({ mode: 'open' }), {
      difficulty: settings.difficulty as SudokuDifficulty,
      unlockMinutes: Number(settings.unlockMinutes),
      jumps: Number(settings.jumps),
    }, site, async (minutes, reason) => {
      const response = await chrome.runtime.sendMessage({ type: 'enter-site', minutes, reason });
      if (!response?.ok) throw new Error('Unlock failed');
      scheduleExpiry(response.unlockedUntil);
      closeGate();
    }, async () => {
      solvedHere = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'sudoku-solved' });
        if (!response?.ok) throw new Error('Unlock failed');
        scheduleExpiry(response.unlockedUntil);
      } catch (error) { solvedHere = false; throw error; }
    });
  } finally {
    checking = false;
    if (checkAgain) { checkAgain = false; void checkGate(); }
  }
}
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'show-sudoku') void checkGate();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sites || (currentSite && changes[sessionKey(currentSite)])) void checkGate();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkGate();
});
void checkGate();
