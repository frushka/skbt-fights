/**
 * Единая цветовая шкала настроения: график, ползунок и подписи рядом с ним
 * должны показывать один цвет, иначе на нуле цифра зелёная, а график янтарный.
 */

/** Цвет в OKLCH: интерполируем численно, чтобы не гонять строки через color-mix. */
export type Oklch = { l: number; c: number; h: number };

export const MOOD_POSITIVE: Oklch = { l: 0.84, c: 0.19, h: 148 };
export const MOOD_NEGATIVE: Oklch = { l: 0.68, c: 0.21, h: 18 };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const oklch = ({ l, c, h }: Oklch, alpha = 1) =>
  `oklch(${l} ${c} ${h} / ${clamp(alpha, 0, 1)})`;

/** Смешивание цветов краёв шкалы: t = 0 — низ шкалы, t = 1 — верх. */
export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  const k = clamp(t, 0, 1);
  return { l: a.l + (b.l - a.l) * k, c: a.c + (b.c - a.c) * k, h: a.h + (b.h - a.h) * k };
}

/** Цвет значения на шкале — готовая строка для CSS или canvas. */
export function moodColor(value: number, min = -100, max = 100, alpha = 1) {
  const span = Math.max(1e-6, max - min);
  return oklch(
    mixOklch(MOOD_NEGATIVE, MOOD_POSITIVE, (clamp(value, min, max) - min) / span),
    alpha,
  );
}
