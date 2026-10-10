/** Focus in a grid of tiles (spec §8.2). Pure: the view owns the index and scrolling. */
import type { InputAction } from "../input/actions";

export type NavResult = { moved: true; index: number } | { moved: false; edge: InputAction };

export class GridNavigator {
  count = 0;
  /** From the viewport's width and the tile's. */
  columns = 1;
  index = 0;

  reset(count: number, columns: number, keepIndex = 0) {
    this.count = count;
    this.columns = Math.max(1, columns);
    this.index = Math.min(Math.max(0, keepIndex), Math.max(0, count - 1));
    return this;
  }

  move(action: InputAction): NavResult {
    const { count, columns } = this;
    const i = this.index;
    let next: number | null = null;
    if (count > 0) {
      if (action === "left" && i % columns > 0) next = i - 1;
      else if (action === "right" && i % columns < columns - 1 && i + 1 < count) next = i + 1;
      else if (action === "up" && i - columns >= 0) next = i - columns;
      else if (action === "down" && i + columns < count) next = i + columns;
      // Down into a shorter last row lands on its last tile.
      else if (action === "down" && Math.floor(i / columns) < Math.floor((count - 1) / columns)) next = count - 1;
    }
    if (next === null) return { moved: false, edge: action };
    this.index = next;
    return { moved: true, index: next };
  }

  /** A screen's worth of rows up or down (LT / RT on a console tab), staying in the column where it can. */
  page(direction: 1 | -1, rows: number): number {
    if (!this.count) return this.index;
    const target = this.index + direction * Math.max(1, rows) * this.columns;
    this.index = Math.min(Math.max(target, this.index % this.columns), this.count - 1);
    return this.index;
  }
}

/** The first letter a title sorts under: a digit or symbol is "#". */
export const letterOf = (title: string) => {
  const c = title.trim().charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
};

/** On All sorted by name (LT / RT): the first tile of the next or previous letter; the same index at either end. */
export function jumpLetter(titles: readonly string[], index: number, direction: 1 | -1): number {
  if (!titles.length) return index;
  const current = letterOf(titles[index]);
  if (direction === 1) {
    const next = titles.findIndex((t, i) => i > index && letterOf(t) !== current);
    return next < 0 ? index : next;
  }
  // Back: to the start of this letter, or when already there, to the start of the one before.
  let start = index;
  while (start > 0 && letterOf(titles[start - 1]) === current) start--;
  if (start < index) return start;
  if (start === 0) return index;
  const previous = letterOf(titles[start - 1]);
  let p = start - 1;
  while (p > 0 && letterOf(titles[p - 1]) === previous) p--;
  return p;
}
