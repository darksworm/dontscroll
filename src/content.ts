import { mountGate } from './gate';
import type { SudokuDifficulty } from './sudoku';

let overlay: HTMLElement | null = null;
let cleanup: (() => void) | undefined;
const pausedMedia = new Set<HTMLMediaElement>();
let checking = false;
let previousFocus: HTMLElement | null = null;
let expiryTimer: number | undefined;

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
    for (const media of pausedMedia) if (media.isConnected) void media.play().catch(() => undefined);
  }
  pausedMedia.clear();
}
async function checkGate() {
  if (checking || overlay) return;
  checking = true;
  try {
    const settings = await chrome.storage.local.get({ difficulty: 'trivial', unlockMinutes: 15, jumps: 10, scrollSession: { unlockedUntil: 0 } });
    const unlockedUntil = Number(settings.scrollSession.unlockedUntil) || 0;
    if (unlockedUntil > Date.now()) {
      scheduleExpiry(unlockedUntil);
      return;
    }
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
    }, location.hostname.replace(/^www\./, ''), async (minutes, reason) => {
      const response = await chrome.runtime.sendMessage({ type: 'enter-site', minutes, reason });
      if (!response?.ok) throw new Error('Unlock failed');
      closeGate();
    }, () => { solvedHere = true; });
  } finally { checking = false; }
}
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'show-sudoku') void checkGate();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.scrollSession) return;
  const unlockedUntil = Number(changes.scrollSession.newValue?.unlockedUntil) || 0;
  if (unlockedUntil > Date.now()) {
    scheduleExpiry(unlockedUntil);
    if (overlay && !solvedHere) closeGate();
  } else void checkGate();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkGate();
});
void checkGate();
