import { createPuzzle, isSolved, type SudokuDifficulty } from './sudoku';

export function mountGate(root: ShadowRoot, settings: { difficulty: SudokuDifficulty; unlockMinutes: number; jumps: number }, website: string, enter: (minutes?: number, reason?: string) => Promise<void>, onSolved?: () => void) {
  let state: 'puzzle' | 'choices' | 'time' = 'puzzle';
  let jumps = settings.jumps > 0 ? 1 + Math.floor(Math.random() * settings.jumps) : 0;
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .screen { position: fixed; inset: 0; z-index: 2147483647; overflow: auto; display: grid; place-items: center; padding: 48px 24px; background: #eeeae2f5; color: #302e28; font: 15px/1.5 system-ui, sans-serif; }
    .card { width: min(100%, 450px); padding: 32px; background: #fffdf8; border: 1px solid #ded8cc; border-radius: 24px; box-shadow: 0 20px 80px #302e2815; }
    h1 { margin: 0; font: 32px/1.2 Georgia, serif; letter-spacing: -.7px; text-align: center; }
    .subtitle { color: #777267; text-align: center; margin: 12px 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(9, 1fr); border: 2px solid #827a69; border-radius: 4px; overflow: hidden; }
    .cell { min-width: 0; width: 100%; aspect-ratio: 1; padding: 0; border: 0; border-right: 1px solid #ded8cc; border-bottom: 1px solid #ded8cc; border-radius: 0; background: #fffefa; color: #276b60; text-align: center; font: 20px Georgia, serif; }
    .cell:disabled { background: #f0ece3; color: #49463f; opacity: 1; }
    .cell:nth-child(3n) { border-right: 2px solid #827a69; }
    .cell:nth-child(9n) { border-right: 0; }
    .cell:nth-child(n+19):nth-child(-n+27), .cell:nth-child(n+46):nth-child(-n+54) { border-bottom: 2px solid #827a69; }
    .cell:nth-child(n+73) { border-bottom: 0; }
    :focus-visible { outline: 3px solid #b89262; outline-offset: 2px; }
    .cell:focus { outline-offset: -3px; }
    .progress { color: #777267; text-align: center; font-size: 12px; margin: 16px 0 0; }
    .choices { display: grid; gap: 12px; }
    button { font: inherit; cursor: pointer; padding: 13px 18px; border: 1px solid #d6cfbf; border-radius: 12px; background: #f4f0e7; color: #403b31; transition: background .15s; }
    button:hover { background: #e7e0d2; }
    button:disabled { opacity: .5; cursor: wait; }
    .primary { background: #365f52; color: white; border-color: #365f52; }
    .primary:hover { background: #274c40; }
    .escape { position: fixed; font-size: 11px; padding: 6px; background: transparent; border: 0; color: #716a5c; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
    input, textarea { font: inherit; padding: 10px; border: 1px solid #d6cfbf; border-radius: 8px; background: #fffefa; color: #302e28; }
    textarea { min-height: 130px; resize: vertical; }
    .count { font-size: 12px; color: #777267; margin: -8px 0 0; }
    .error { color: #a33b32; font-size: 13px; }
    @media(max-width: 420px) { .card { padding: 20px; } h1 { font-size: 27px; } }
  </style><div class="screen" role="dialog" aria-modal="true" aria-label="Scrolling pause"><main class="card"><section id="puzzle"><h1></h1><p class="subtitle"></p><div class="grid" aria-label="Sudoku"></div><p class="progress" aria-live="polite"></p></section><section class="choices" hidden></section><form hidden><h1>I need more time</h1><p class="subtitle">Make a little room for an intentional visit.</p><label>Extra minutes (1–60)<input type="number" min="1" max="60" step="1" value="5" required></label><label>Why do you need more time?<textarea minlength="80" required placeholder="Describe what you want to do and why it matters."></textarea></label><p class="count" aria-live="polite">0 / 80 characters</p><button class="primary" type="submit">Enter with more time</button><button type="button" class="back">Back</button></form><p class="error" role="alert" hidden></p></main><button class="escape" type="button">go to the site</button></div>`;
  const select = <T extends HTMLElement>(query: string) => root.querySelector<T>(query)!;
  const puzzleSection = select<HTMLElement>('#puzzle');
  const choices = select<HTMLElement>('.choices');
  const form = select<HTMLFormElement>('form');
  const escape = select<HTMLButtonElement>('.escape');
  const error = select<HTMLElement>('.error');
  const grid = select<HTMLElement>('.grid');
  const reason = select<HTMLTextAreaElement>('textarea');
  const minutes = select<HTMLInputElement>('input[type=number]');
  let busy = false;
  const run = async (extra?: number, explanation?: string) => {
    if (busy) return;
    busy = true;
    error.hidden = true;
    root.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
    try { await enter(extra, explanation); }
    catch { error.textContent = 'Could not unlock the site. Please try again.'; error.hidden = false; }
    finally { busy = false; root.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = false); }
  };
  const render = (next: typeof state) => {
    state = next;
    puzzleSection.hidden = state !== 'puzzle';
    choices.hidden = state !== 'choices';
    form.hidden = state !== 'time';
    escape.hidden = state !== 'puzzle';
    error.hidden = true;
    if (state === 'choices') choices.querySelector<HTMLButtonElement>('button')?.focus();
    if (state === 'time') minutes.focus();
  };
  for (const [text, action] of [
    ['Play more Sudoku', () => startPuzzle()],
    ['Do a crossword', () => { window.open('https://www.boatloadpuzzles.com/playcrossword', '_blank', 'noopener,noreferrer'); }],
    ['Go to the site', () => { void run(); }],
    ['I need more time', () => render('time')],
  ] as const) {
    const button = document.createElement('button');
    button.textContent = text;
    button.type = 'button';
    button.addEventListener('click', action);
    choices.append(button);
  }
  function showChoices() {
    const buttons = Array.from(choices.children);
    for (let index = buttons.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [buttons[index], buttons[swap]] = [buttons[swap], buttons[index]];
    }
    if (buttons.every((button, index) => button === choices.children[index])) buttons.push(buttons.shift()!);
    choices.replaceChildren(...buttons);
    render('choices');
  }
  function startPuzzle() {
    const puzzle = createPuzzle(settings.difficulty);
    grid.replaceChildren();
    const cells: HTMLInputElement[] = [];
    select('h1').textContent = `Earn your ${settings.unlockMinutes} minutes`;
    select('.subtitle').textContent = `Complete this Sudoku before opening ${website}`;
    const update = () => {
      const remaining = cells.filter(cell => !cell.value).length;
      select('.progress').textContent = remaining ? `${remaining} numbers to go` : 'Check your numbers';
      if (isSolved(cells.map(cell => cell.value), puzzle.solution)) {
        showChoices();
        onSolved?.();
        void chrome.runtime.sendMessage({ type: 'sudoku-solved' }).catch(() => undefined);
      }
    };
    for (let index = 0; index < 81; index++) {
      const cell = document.createElement('input');
      cell.className = 'cell';
      cell.maxLength = 1;
      cell.inputMode = 'numeric';
      cell.autocomplete = 'off';
      cell.setAttribute('aria-label', `Row ${Math.floor(index / 9) + 1}, column ${index % 9 + 1}`);
      cell.disabled = puzzle.puzzle[index] !== '-';
      cell.value = cell.disabled ? puzzle.puzzle[index] : '';
      cell.addEventListener('input', () => { cell.value = cell.value.replace(/[^1-9]/g, ''); update(); });
      cells.push(cell);
      grid.append(cell);
    }
    render('puzzle');
    update();
    cells.find(cell => !cell.disabled)?.focus();
    requestAnimationFrame(placeLink);
  }
  function placeLink() {
    if (state !== 'puzzle') return;
    const bounds = grid.getBoundingClientRect();
    const link = escape.getBoundingClientRect();
    const maxLeft = Math.max(8, innerWidth - link.width - 8);
    const maxTop = Math.max(8, innerHeight - link.height - 8);
    const regions = [
      [8, 8, maxLeft, Math.min(maxTop, bounds.top - link.height - 12)],
      [8, Math.max(8, bounds.bottom + 12), maxLeft, maxTop],
      [8, Math.max(8, bounds.top - link.height - 12), Math.min(maxLeft, bounds.left - link.width - 12), Math.min(maxTop, bounds.bottom + 12)],
      [Math.max(8, bounds.right + 12), Math.max(8, bounds.top - link.height - 12), maxLeft, Math.min(maxTop, bounds.bottom + 12)],
    ].filter(([left, top, right, bottom]) => right > left && bottom > top);
    const areas = regions.map(([left, top, right, bottom]) => (right - left) * (bottom - top));
    let sample = Math.random() * areas.reduce((total, area) => total + area, 0);
    const index = areas.findIndex(area => (sample -= area) < 0);
    const [left, top, right, bottom] = regions[index] ?? [8, 8, maxLeft, 8];
    escape.style.left = `${left + Math.random() * (right - left)}px`;
    escape.style.top = `${top + Math.random() * (bottom - top)}px`;
  }
  escape.addEventListener('pointerenter', () => { if (jumps > 0) { jumps--; placeLink(); } });
  escape.addEventListener('click', () => void run());
  select('.back').addEventListener('click', () => render('choices'));
  reason.addEventListener('input', () => { reason.setCustomValidity(''); select('.count').textContent = `${reason.value.trim().length} / 80 characters`; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    reason.setCustomValidity(reason.value.trim().length < 80 ? 'Write at least 80 characters, excluding surrounding spaces.' : '');
    if (form.reportValidity()) void run(Number(minutes.value), reason.value.trim());
  });
  window.addEventListener('resize', placeLink);
  select('.screen').addEventListener('scroll', placeLink);
  startPuzzle();
  return () => window.removeEventListener('resize', placeLink);
}
