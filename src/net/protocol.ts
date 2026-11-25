import type { Color } from '../chess/types';
import type { GameResult } from '../chess/game';

/** Versão do protocolo trocado pelo DataChannel. */
export const PROTOCOL_VERSION = 1;

export type OfferState = 'none' | 'sent' | 'received';

/** Estado completo da partida, enviado pelo anfitrião ao convidado (início, reconexão, revanche, ressincronização). */
export interface StateMsg {
  t: 'state';
  gameNo: number;
  timeMs: number;
  hostColor: Color;
  moves: string[];
  /** Tempos restantes no momento do envio. */
  clock: { w: number; b: number; running: Color | null };
  result: GameResult | null;
  /** Quem fez a oferta pendente de empate / revanche. */
  drawOfferBy: Color | null;
  rematchOfferBy: Color | null;
}

export type Msg =
  // Convidado → anfitrião ao conectar (ou reconectar). O token identifica o convidado.
  | { t: 'hello'; v: number; token: string }
  // Anfitrião → convidado: a sala já tem outro jogador.
  | { t: 'full' }
  | StateMsg
  // Qualquer lado: um lance seu. `ply` é o índice do lance (0 = primeiro lance das brancas).
  | { t: 'move'; gameNo: number; ply: number; uci: string }
  // Anfitrião → convidado: tempos oficiais após o lance `ply` (o relógio do anfitrião é a autoridade).
  | { t: 'clock'; gameNo: number; ply: number; w: number; b: number; running: Color | null }
  // Anfitrião → convidado: fim da partida decidido pelo anfitrião (tempo, desistência, acordo, abandono).
  | { t: 'end'; gameNo: number; result: GameResult }
  | { t: 'resign'; gameNo: number }
  | { t: 'draw-offer'; gameNo: number }
  | { t: 'draw-accept'; gameNo: number }
  | { t: 'draw-decline'; gameNo: number }
  | { t: 'rematch-offer'; gameNo: number }
  | { t: 'rematch-accept'; gameNo: number }
  // Convidado → anfitrião: pede o estado completo (ex.: após receber um lance inválido).
  | { t: 'sync-request' }
  // Batimento usado pela camada de conexão para detectar queda.
  | { t: 'ping' }
  | { t: 'pong' };

const COLORS = new Set(['w', 'b']);
const isColorOrNull = (c: unknown) => c === null || COLORS.has(c as string);
const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const isUci = (s: unknown) => typeof s === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s);

/** Valida a forma da mensagem recebida do par. Não confia em nada que chega pela rede. */
export function parseMsg(raw: unknown): Msg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return isNum(m.v) && typeof m.token === 'string' && m.token.length <= 64 ? (m as unknown as Msg) : null;
    case 'full':
    case 'sync-request':
    case 'ping':
    case 'pong':
      return { t: m.t };
    case 'state': {
      const c = m.clock as Record<string, unknown> | undefined;
      const ok =
        isNum(m.gameNo) &&
        isNum(m.timeMs) &&
        COLORS.has(m.hostColor as string) &&
        Array.isArray(m.moves) &&
        m.moves.length <= 2000 &&
        m.moves.every(isUci) &&
        !!c &&
        isNum(c.w) &&
        isNum(c.b) &&
        isColorOrNull(c.running) &&
        isColorOrNull(m.drawOfferBy) &&
        isColorOrNull(m.rematchOfferBy) &&
        (m.result === null || isResult(m.result));
      return ok ? (m as unknown as Msg) : null;
    }
    case 'move':
      return isNum(m.gameNo) && isNum(m.ply) && isUci(m.uci) ? (m as unknown as Msg) : null;
    case 'clock':
      return isNum(m.gameNo) && isNum(m.ply) && isNum(m.w) && isNum(m.b) && isColorOrNull(m.running)
        ? (m as unknown as Msg)
        : null;
    case 'end':
      return isNum(m.gameNo) && isResult(m.result) ? (m as unknown as Msg) : null;
    case 'resign':
    case 'draw-offer':
    case 'draw-accept':
    case 'draw-decline':
    case 'rematch-offer':
    case 'rematch-accept':
      return isNum(m.gameNo) ? (m as unknown as Msg) : null;
    default:
      return null;
  }
}

const REASONS = new Set([
  'checkmate', 'stalemate', 'threefold', 'fifty-moves', 'insufficient',
  'timeout', 'timeout-insufficient', 'resign', 'agreement', 'abandon',
]);

function isResult(r: unknown): r is GameResult {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return isColorOrNull(o.winner) && REASONS.has(o.reason as string);
}
