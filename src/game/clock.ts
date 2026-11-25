import type { Color } from '../chess/types';

/** Limite máximo de tempo por jogador. Altere aqui para mudar o teto do relógio. */
export const MAX_TIME_MINUTES = 15;

/** Opções de tempo oferecidas na criação da sala (filtradas pelo limite máximo). */
export const TIME_OPTIONS_MINUTES = [3, 5, 10, 15].filter((m) => m <= MAX_TIME_MINUTES);

export function clampTimeMs(ms: number): number {
  const max = MAX_TIME_MINUTES * 60_000;
  if (!Number.isFinite(ms) || ms <= 0) return max;
  return Math.min(ms, max);
}

/** Relógio de xadrez sem incremento. Recebe o tempo atual de fora para ser testável. */
export class ChessClock {
  private remaining: Record<Color, number>;
  private _running: Color | null = null;
  private since = 0;

  constructor(timeMs: number) {
    this.remaining = { w: timeMs, b: timeMs };
  }

  get running(): Color | null {
    return this._running;
  }

  timeLeft(color: Color, now: number): number {
    const base = this.remaining[color];
    return Math.max(0, this._running === color ? base - (now - this.since) : base);
  }

  /** Para o relógio que está correndo e liga o da cor `color` (ou nenhum, se null). */
  switchTo(color: Color | null, now: number): void {
    if (this._running) this.remaining[this._running] = this.timeLeft(this._running, now);
    this._running = color;
    this.since = now;
  }

  stop(now: number): void {
    this.switchTo(null, now);
  }

  /** Define os tempos a partir de uma sincronização (valores medidos agora). */
  set(w: number, b: number, running: Color | null, now: number): void {
    this.remaining = { w: Math.max(0, w), b: Math.max(0, b) };
    this._running = running;
    this.since = now;
  }

  /** Cor cujo tempo acabou, ou null. */
  flagged(now: number): Color | null {
    return this._running && this.timeLeft(this._running, now) <= 0 ? this._running : null;
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 10_000) {
    // Abaixo de 10 s mostra décimos.
    const s = Math.floor(total / 1000);
    const tenths = Math.floor((total % 1000) / 100);
    return `0:0${s}.${tenths}`;
  }
  const secs = Math.ceil(total / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
