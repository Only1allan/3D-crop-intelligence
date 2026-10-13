// Farm layout in scene units (~metres / 10). Plots on a 3 x 2 grid.
export const PLOT_W = 16
export const PLOT_D = 11
export const GAP = 3.6
export const ROWS = 8
export const PER_ROW = 13

export function plotCenter([col, row]) {
  return [(col - 1) * (PLOT_W + GAP), (row - 0.5) * (PLOT_D + GAP)]
}
export const HUB = [0, 0]              // weather station on the central path
export const HOME_CAM = { pos: [6, 50, 64], target: [6, 0, 3] }

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
