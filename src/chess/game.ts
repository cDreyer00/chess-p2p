import {
  START_FEN,
  applyMove,
  canMate,
  findMoveByUci,
  inCheck,
  isInsufficientMaterial,
  legalMoves,
  parseFen,
  repetitionKey,
} from './position';
import { toSan } from './san';
import { type Color, type Move, type Piece, type Position, moveToUci, opposite } from './types';

export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-moves'
  | 'insufficient'
  | 'timeout'
  | 'timeout-insufficient'
  | 'resign'
  | 'agreement'
  | 'abandon';

export interface GameResult {
  /** Vencedor, ou null em caso de empate. */
  readonly winner: Color | null;
  readonly reason: ResultReason;
}

export interface PlayedMove {
  readonly move: Move;
  readonly san: string;
  readonly uci: string;
}

/**
 * Partida: posição atual, histórico e detecção de fim de jogo.
 * Fins automáticos: mate, afogamento, tripla repetição, 50 lances e material insuficiente.
 * Fins externos (relógio, desistência, acordo) entram por `finish()`.
 */
export class Game {
  private positions: Position[];
  private readonly played: PlayedMove[] = [];
  private readonly keys: string[];
  private _result: GameResult | null = null;

  constructor(fen: string = START_FEN) {
    const start = parseFen(fen);
    this.positions = [start];
    this.keys = [repetitionKey(start)];
    this._result = this.detectEnd();
  }

  get position(): Position {
    return this.positions[this.positions.length - 1];
  }

  get turn(): Color {
    return this.position.turn;
  }

  get history(): readonly PlayedMove[] {
    return this.played;
  }

  get result(): GameResult | null {
    return this._result;
  }

  get isOver(): boolean {
    return this._result !== null;
  }

  get lastMove(): Move | null {
    return this.played.length ? this.played[this.played.length - 1].move : null;
  }

  legalMoves(): Move[] {
    return this.isOver ? [] : legalMoves(this.position);
  }

  inCheck(): boolean {
    return inCheck(this.position);
  }

  /** Joga o lance em UCI. Devolve o lance jogado ou null se for ilegal (ou a partida já acabou). */
  playUci(uci: string): PlayedMove | null {
    if (this.isOver) return null;
    const move = findMoveByUci(this.position, uci);
    return move ? this.play(move) : null;
  }

  private play(move: Move): PlayedMove {
    const before = this.position;
    const san = toSan(before, move);
    const next = applyMove(before, move);
    const pm: PlayedMove = { move, san, uci: moveToUci(move) };
    this.positions.push(next);
    this.keys.push(repetitionKey(next));
    this.played.push(pm);
    this._result = this.detectEnd();
    return pm;
  }

  /** Encerra a partida por motivo externo (relógio, desistência, acordo, abandono). */
  finish(result: GameResult): void {
    if (!this._result) this._result = result;
  }

  /** Resultado quando o jogador `flagged` zera o relógio. */
  timeoutResult(flagged: Color): GameResult {
    const other = opposite(flagged);
    return canMate(this.position.board, other)
      ? { winner: other, reason: 'timeout' }
      : { winner: null, reason: 'timeout-insufficient' };
  }

  /** Peças capturadas de cada cor (as peças da cor indicada que saíram do tabuleiro). */
  captured(): Record<Color, Piece[]> {
    const out: Record<Color, Piece[]> = { w: [], b: [] };
    for (const { move } of this.played) if (move.captured) out[move.captured.color].push(move.captured);
    return out;
  }

  private detectEnd(): GameResult | null {
    const pos = this.position;
    if (legalMoves(pos).length === 0) {
      return inCheck(pos)
        ? { winner: opposite(pos.turn), reason: 'checkmate' }
        : { winner: null, reason: 'stalemate' };
    }
    if (isInsufficientMaterial(pos.board)) return { winner: null, reason: 'insufficient' };
    const key = this.keys[this.keys.length - 1];
    if (this.keys.filter((k) => k === key).length >= 3) return { winner: null, reason: 'threefold' };
    if (pos.halfmove >= 100) return { winner: null, reason: 'fifty-moves' };
    return null;
  }
}
