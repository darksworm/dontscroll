import { getSudoku } from 'sudoku-gen';

export type SudokuPuzzle = {
  puzzle: string;
  solution: string;
};

export type SudokuDifficulty = 'braindead' | 'easy' | 'medium' | 'hard' | 'evil';

const emptyCellCounts: Record<SudokuDifficulty, number> = {
  braindead: 2,
  easy: 9,
  medium: 20,
  hard: 35,
  evil: 50,
};

export function createPuzzle(difficulty: SudokuDifficulty = 'easy'): SudokuPuzzle {
  const generated = getSudoku(difficulty === 'evil' ? 'expert' : difficulty === 'braindead' ? 'easy' : difficulty);
  const puzzle = generated.puzzle.split('');
  const emptyCells = puzzle
    .map((value, index) => (value === '-' ? index : -1))
    .filter((index) => index >= 0);
  const targetEmptyCells = emptyCellCounts[difficulty];

  while (emptyCells.length > targetEmptyCells) {
    const index = emptyCells.splice(Math.floor(Math.random() * emptyCells.length), 1)[0];
    puzzle[index] = generated.solution[index];
  }

  return { puzzle: puzzle.join(''), solution: generated.solution };
}

export function isSolved(values: string[], solution: string): boolean {
  return values.length === 81 && values.join('') === solution;
}
