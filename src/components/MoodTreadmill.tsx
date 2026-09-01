import { useEffect, useRef } from "react";
import {
  clamp,
  mixOklch,
  MOOD_NEGATIVE,
  MOOD_POSITIVE,
  oklch as css,
  type Oklch,
} from "@/lib/mood-color";

/**
 * Виджет настроения зала: справа — активная вертикальная шкала с текущим значением,
 * влево от неё уезжает история в виде сглаженного area-графика («беговая дорожка»).
 *
 * Всё рисуется на canvas в одном requestAnimationFrame-цикле: положение точек считается
 * от реального времени (x = f(now - t)), поэтому движение не зависит от частоты прихода
 * данных и не дёргается при перерисовке React.
 *
 * Настройка — через пропсы, значения по умолчанию собраны в блоке констант ниже.
 */

export type MoodTreadmillProps = {
  /** Текущее значение. Обновляйте как угодно часто — анимация сгладит скачки. */
  value: number;
  /** Границы шкалы. */
  min?: number;
  max?: number;
  /** Сколько секунд истории помещается в видимую область (скорость дорожки). */
  windowMs?: number;
  /** Шаг записи истории. Реже — дешевле и «мягче», чаще — детальнее. */
  sampleMs?: number;
  /** Инерция линии: время, за которое она проходит ~63% пути до нового значения. */
  smoothingMs?: number;
  /** Сглаживание кривой: 0 — ломаная, 1 — классический Catmull-Rom, >1 — «резиновее». */
  tension?: number;
  /** Максимальная непрозрачность заливки у линии. */
  fillAlpha?: number;
  /** Цвета для крайних значений шкалы. */
  positiveColor?: Oklch;
  negativeColor?: Oklch;
  /** Ширина правой активной шкалы в пикселях. */
  scaleWidth?: number;
  /** Радиус ползунка. Больше половины ширины шкалы — ползунок выступает за трек. */
  thumbRadius?: number;
  className?: string;
};

// ─── Настройки по умолчанию ──────────────────────────────────────────────────
const DEFAULT_WINDOW_MS = 600_000;
/**
 * Шаг записи подобран под окно: за 10 минут при широком экране один замер приходится
 * примерно на полтора пикселя. Писать чаще смысла нет — точки лягут в один столбец,
 * а перерисовка кривой подорожает в разы.
 */
const DEFAULT_SAMPLE_MS = 500;
const DEFAULT_SMOOTHING_MS = 240;
const DEFAULT_TENSION = 1;
const DEFAULT_FILL_ALPHA = 0.55;
/** Насколько быстро заливка гаснет к нулевой линии: <1 — плотнее, >1 — воздушнее. */
const FILL_FALLOFF = 0.55;
const FILL_STOPS = 6;
const POSITIVE = MOOD_POSITIVE;
const NEGATIVE = MOOD_NEGATIVE;

// Геометрия: правая активная шкала и отступы вокруг поля графика.
const DEFAULT_SCALE_WIDTH = 32;
const DEFAULT_THUMB_RADIUS = 13;
const SCALE_GAP = 20;
const PAD_Y = 16;
const PAD_LEFT = 4;
const LINE_WIDTH = 2.5;
/** Ширина «растворения» истории у левого края, в долях ширины поля. */
const FADE_RATIO = 0.16;

type Sample = { t: number; v: number };
type Point = { x: number; y: number };

/**
 * Кривая Catmull-Rom, переписанная в кубические Безье: контрольные точки берутся
 * из соседей, поэтому линия проходит ровно через данные и не имеет изломов.
 */
function strokeSpline(ctx: CanvasRenderingContext2D, pts: Point[], tension: number) {
  const start = pts[0];
  if (!start) return;
  ctx.moveTo(start.x, start.y);
  const k = tension / 6;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (!p1 || !p2) continue;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * k,
      p1.y + (p2.y - p0.y) * k,
      p2.x - (p3.x - p1.x) * k,
      p2.y - (p3.y - p1.y) * k,
      p2.x,
      p2.y,
    );
  }
}

export function MoodTreadmill({
  value,
  min = -100,
  max = 100,
  windowMs = DEFAULT_WINDOW_MS,
  sampleMs = DEFAULT_SAMPLE_MS,
  smoothingMs = DEFAULT_SMOOTHING_MS,
  tension = DEFAULT_TENSION,
  fillAlpha = DEFAULT_FILL_ALPHA,
  positiveColor = POSITIVE,
  negativeColor = NEGATIVE,
  scaleWidth = DEFAULT_SCALE_WIDTH,
  thumbRadius = DEFAULT_THUMB_RADIUS,
  className,
}: MoodTreadmillProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Живые значения держим в ref: перерисовка React не должна перезапускать rAF-цикл.
  const latest = {
    value,
    min,
    max,
    windowMs,
    sampleMs,
    smoothingMs,
    tension,
    fillAlpha,
    positiveColor,
    negativeColor,
    scaleWidth,
    thumbRadius,
  };
  const cfg = useRef(latest);
  cfg.current = latest;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const samples: Sample[] = [];
    let display = clamp(cfg.current.value, cfg.current.min, cfg.current.max);
    let last = performance.now();
    let sinceSample = 0;
    let sampleArea = 0; // ∫ display dt за текущий интервал — из него берём среднее
    let raf = 0;

    const draw = (now: number) => {
      const { min, max, windowMs, fillAlpha, tension, scaleWidth, thumbRadius } = cfg.current;
      const plotLeft = PAD_LEFT;
      const scaleX = width - scaleWidth; // левый край трека
      // Кривая доводится до центра ползунка и уходит под трек: иначе между её концом
      // и ползунком зияет промежуток и график перестаёт «вытекать» из шкалы.
      const plotRight = scaleX + scaleWidth / 2;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      // Сетка под шкалу не лезет — она фон, а не часть активного элемента.
      const gridRight = scaleX - SCALE_GAP;
      const top = PAD_Y;
      const bottom = height - PAD_Y;
      const span = Math.max(1e-6, max - min);
      const y = (v: number) => bottom - ((clamp(v, min, max) - min) / span) * (bottom - top);
      const pxPerMs = plotWidth / windowMs;

      const ratio = (display - min) / span; // 0 — низ шкалы, 1 — верх
      const color = mixOklch(cfg.current.negativeColor, cfg.current.positiveColor, ratio);
      const baselineY = y(clamp(0, min, max));
      const headY = y(display);

      ctx.clearRect(0, 0, width, height);

      // Сетка: нулевая линия жирнее, отметки ±50% — еле заметные.
      ctx.lineWidth = 1;
      for (const level of [max, (max + (max + min) / 2) / 2, (min + (max + min) / 2) / 2, min]) {
        ctx.strokeStyle = "oklch(0.72 0.03 255 / 0.1)";
        ctx.beginPath();
        ctx.moveTo(plotLeft, Math.round(y(level)) + 0.5);
        ctx.lineTo(gridRight, Math.round(y(level)) + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = "oklch(0.72 0.03 255 / 0.28)";
      ctx.beginPath();
      ctx.moveTo(plotLeft, Math.round(baselineY) + 0.5);
      ctx.lineTo(gridRight, Math.round(baselineY) + 0.5);
      ctx.stroke();

      // Точки истории: x зависит от возраста замера, поэтому дорожка едет равномерно.
      const pts: Point[] = [];
      for (const s of samples) {
        const x = plotRight - (now - s.t) * pxPerMs;
        if (x < plotLeft - 60) continue;
        pts.push({ x, y: y(s.v) });
      }
      pts.push({ x: plotRight, y: headY }); // голова графика — ровно на ползунке шкалы

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotLeft, 0, plotWidth, height);
      ctx.clip();

      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      if (firstPoint && lastPoint && pts.length >= 2) {
        // Заливка: плотная у краёв шкалы и полностью прозрачная на нулевой линии.
        // Профиль нелинейный (FILL_FALLOFF), иначе на тёмном фоне заливка почти не читается.
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        const zero = clamp((baselineY - top) / Math.max(1, bottom - top), 0.001, 0.999);
        for (let i = 0; i <= FILL_STOPS; i++) {
          const p = i / FILL_STOPS; // 0 — у нулевой линии, 1 — у края шкалы
          const alpha = fillAlpha * Math.pow(p, FILL_FALLOFF);
          gradient.addColorStop(zero * (1 - p), css(color, alpha));
          gradient.addColorStop(zero + (1 - zero) * p, css(color, alpha));
        }

        ctx.beginPath();
        strokeSpline(ctx, pts, tension);
        ctx.lineTo(lastPoint.x, baselineY);
        ctx.lineTo(firstPoint.x, baselineY);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Линия со свечением — «кардиограмма».
        ctx.beginPath();
        strokeSpline(ctx, pts, tension);
        ctx.lineWidth = LINE_WIDTH;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = css(color, 0.95);
        ctx.shadowColor = css(color, 0.55);
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Хвост истории растворяется у левого края, чтобы график не «обрубался».
      const fade = ctx.createLinearGradient(plotLeft, 0, plotLeft + plotWidth * FADE_RATIO, 0);
      fade.addColorStop(0, "rgba(0,0,0,1)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = fade;
      ctx.fillRect(plotLeft, 0, plotWidth * FADE_RATIO, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      // ─── Правая активная шкала ───
      const sx = scaleX;
      const radius = scaleWidth / 2;
      ctx.beginPath();
      ctx.roundRect(sx, top, scaleWidth, bottom - top, radius);
      ctx.fillStyle = "oklch(0.28 0.04 258 / 0.88)";
      ctx.fill();
      ctx.strokeStyle = "oklch(0.72 0.03 255 / 0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx, top, scaleWidth, bottom - top, radius);
      ctx.clip();
      const barTop = Math.min(headY, baselineY);
      const barHeight = Math.abs(headY - baselineY);
      const barGradient = ctx.createLinearGradient(0, headY, 0, baselineY);
      barGradient.addColorStop(0, css(color, 0.95));
      barGradient.addColorStop(1, css(color, 0.25));
      ctx.fillStyle = barGradient;
      ctx.fillRect(sx, barTop, scaleWidth, barHeight);
      ctx.restore();

      // Ползунок — точка, из которой «вытекает» график.
      ctx.beginPath();
      ctx.arc(sx + radius, headY, thumbRadius, 0, Math.PI * 2);
      ctx.fillStyle = css(color, 1);
      ctx.shadowColor = css(color, 0.7);
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { min, max, smoothingMs, sampleMs, windowMs } = cfg.current;

      // Кадр после возврата на вкладку может быть длинным — ограничиваем шаг.
      const dt = Math.min(now - last, 250);
      last = now;

      const target = clamp(cfg.current.value, min, max);
      display += (target - display) * (1 - Math.exp(-dt / Math.max(1, smoothingMs)));

      // В историю пишем среднее за интервал, а не мгновенный снимок: на длинном окне
      // между замерами проходит полсекунды, и снимок раз в полсекунды терял бы всплески.
      sinceSample += dt;
      sampleArea += display * dt;
      if (sinceSample >= sampleMs) {
        samples.push({ t: now, v: sampleArea / sinceSample });
        sinceSample = 0;
        sampleArea = 0;
      }
      const cutoff = now - windowMs - sampleMs * 4;
      while (samples.length > 1) {
        const second = samples[1];
        if (!second || second.t >= cutoff) break;
        samples.shift();
      }

      draw(now);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={`Настроение зала: ${Math.round(value)} из ${max}`}
    />
  );
}

export default MoodTreadmill;
