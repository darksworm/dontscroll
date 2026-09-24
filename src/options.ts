const difficulty = document.querySelector<HTMLSelectElement>('#difficulty');
const jumps = document.querySelector<HTMLInputElement>('#jumps');
const unlockMinutes = document.querySelector<HTMLInputElement>('#unlock-minutes');
const save = document.querySelector<HTMLButtonElement>('#save');
const resetSession = document.querySelector<HTMLButtonElement>('#reset-session');
const timeLeft = document.querySelector<HTMLElement>('#time-left');
const saved = document.querySelector<HTMLElement>('#saved');

if (!difficulty || !jumps || !unlockMinutes || !save || !resetSession || !timeLeft || !saved) throw new Error('Settings page is missing required elements');

void chrome.storage.local.get({ difficulty: 'easy', jumps: 10, unlockMinutes: 15, scrollSession: { unlockedUntil: 0 } }).then((settings) => {
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
  });
});
