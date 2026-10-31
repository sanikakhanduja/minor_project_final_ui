// Static warehouse layout parsed from the MovingAI .map named by replay.meta.map_name.
// Obstacles on the outer ring are the building wall; every other obstacle is a rack cell.
import type { Cell } from '../types';

export const CELL_FREE = 0;
export const CELL_RACK = 1;
export const CELL_WALL = 2;

export interface Grid {
  width: number;
  height: number;
  cells: Uint8Array; // index y * width + x
}

export function parseMovingAiMap(text: string): Grid {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
  if (!lines[0]?.startsWith('type')) throw new Error('not a MovingAI map');
  const height = parseInt(lines[1].split(/\s+/)[1], 10);
  const width = parseInt(lines[2].split(/\s+/)[1], 10);
  const obstacles: Cell[] = [];
  for (let y = 0; y < height; y++) {
    const row = lines[4 + y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === '@' || ch === 'T' || ch === 'O') obstacles.push([x, y]);
    }
  }
  return gridFromObstacles(width, height, obstacles);
}

/** Fallback when the .map file is missing: replay.map holds the obstacle list (as of the end of the run). */
export function gridFromObstacles(width: number, height: number, obstacles: Cell[]): Grid {
  const cells = new Uint8Array(width * height);
  for (const [x, y] of obstacles) {
    const onRing = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    cells[y * width + x] = onRing ? CELL_WALL : CELL_RACK;
  }
  return { width, height, cells };
}

export function cellsOfKind(grid: Grid, kind: number): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[y * grid.width + x] === kind) out.push([x, y]);
    }
  }
  return out;
}
