import { mountGate } from './gate';
import type { SudokuDifficulty } from './sudoku';

const target = new URLSearchParams(location.search).get('target');
if (!target || !/^https?:$/.test(new URL(target).protocol)) throw new Error('Invalid destination');
const host = document.createElement('div');
document.body.replaceChildren(host);
void chrome.storage.local.get({ difficulty: 'easy', unlockMinutes: 15, jumps: 10 }).then(settings => {
  mountGate(host.attachShadow({ mode: 'open' }), {
    difficulty: settings.difficulty as SudokuDifficulty,
    unlockMinutes: Number(settings.unlockMinutes),
    jumps: Number(settings.jumps),
  }, new URL(target).hostname.replace(/^www\./, ''), async (minutes, reason) => {
    const response = await chrome.runtime.sendMessage({ type: 'enter-site', minutes, reason });
    if (!response?.ok) throw new Error('Unlock failed');
    location.replace(target);
  });
});
