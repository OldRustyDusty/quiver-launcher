import { describe, expect, it } from "vitest";
import { GridNavigator, jumpLetter, letterOf } from "./grid";

describe("GridNavigator", () => {
  // 10 tiles in 4 columns:
  //  0 1 2 3
  //  4 5 6 7
  //  8 9
  const grid = (index: number) => new GridNavigator().reset(10, 4, index);

  it("moves within the grid", () => {
    expect(grid(5).move("left")).toEqual({ moved: true, index: 4 });
    expect(grid(5).move("right")).toEqual({ moved: true, index: 6 });
    expect(grid(5).move("up")).toEqual({ moved: true, index: 1 });
    expect(grid(5).move("down")).toEqual({ moved: true, index: 9 });
  });

  it("reports an edge instead of wrapping", () => {
    expect(grid(4).move("left")).toEqual({ moved: false, edge: "left" });
    expect(grid(3).move("right")).toEqual({ moved: false, edge: "right" });
    expect(grid(2).move("up")).toEqual({ moved: false, edge: "up" });
    expect(grid(9).move("right")).toEqual({ moved: false, edge: "right" });
    expect(grid(9).move("down")).toEqual({ moved: false, edge: "down" });
  });

  it("goes down into a shorter last row onto its last tile", () => {
    expect(grid(7).move("down")).toEqual({ moved: true, index: 9 });
    expect(grid(6).move("down")).toEqual({ moved: true, index: 9 });
  });

  it("has nowhere to go when empty", () => {
    expect(new GridNavigator().reset(0, 4).move("down")).toEqual({ moved: false, edge: "down" });
  });

  it("keeps the index when the columns change, clamped to the tiles there are", () => {
    const nav = grid(9);
    nav.reset(10, 6, nav.index);
    expect(nav.index).toBe(9);
    expect(nav.move("up")).toEqual({ moved: true, index: 3 });
    expect(new GridNavigator().reset(3, 4, 9).index).toBe(2);
    expect(new GridNavigator().reset(3, 0).columns).toBe(1);
  });

  it("pages by a screen of rows, staying in the column", () => {
    const nav = new GridNavigator().reset(40, 4, 1);
    expect(nav.page(1, 3)).toBe(13);
    expect(nav.page(1, 10)).toBe(39);
    expect(nav.page(-1, 3)).toBe(27);
    expect(nav.page(-1, 30)).toBe(3);
  });
});

describe("jumpLetter", () => {
  const titles = ["2 Ship 2 Harkinian", "Ace Combat", "Ape Escape", "Banjo", "Blue", "Bomberman", "Zelda"];

  it("files digits and symbols under #", () => {
    expect(letterOf("2 Ship")).toBe("#");
    expect(letterOf("  ape")).toBe("A");
  });

  it("jumps forward to the next letter, and stays at the end", () => {
    expect(jumpLetter(titles, 0, 1)).toBe(1);
    expect(jumpLetter(titles, 1, 1)).toBe(3);
    expect(jumpLetter(titles, 4, 1)).toBe(6);
    expect(jumpLetter(titles, 6, 1)).toBe(6);
  });

  it("jumps back to the start of this letter, then to the letter before", () => {
    expect(jumpLetter(titles, 5, -1)).toBe(3);
    expect(jumpLetter(titles, 3, -1)).toBe(1);
    expect(jumpLetter(titles, 1, -1)).toBe(0);
    expect(jumpLetter(titles, 0, -1)).toBe(0);
  });
});
