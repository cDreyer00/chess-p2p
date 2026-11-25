/** Regras de xadrez puras: sem DOM, sem rede. */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

/** Casa de 0 a 63: índice = fileira * 8 + coluna (a1 = 0, h1 = 7, a8 = 56, h8 = 63). */
export type Square = number;

export interface CastlingRights {
  readonly wk: boolean;
  readonly wq: boolean;
  readonly bk: boolean;
  readonly bq: boolean;
}

export interface Position {
  readonly board: ReadonlyArray<Piece | null>;
  readonly turn: Color;
  readonly castling: CastlingRights;
  /** Casa de destino de uma captura en passant (a casa "pulada"), ou null. */
  readonly ep: Square | null;
  readonly halfmove: number;
  readonly fullmove: number;
}

export interface Move {
  readonly from: Square;
  readonly to: Square;
  readonly piece: Piece;
  readonly captured?: Piece;
  readonly promotion?: PromotionPiece;
  readonly castle?: 'k' | 'q';
  readonly enPassant?: boolean;
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const fileOf = (sq: Square): number => sq & 7;
export const rankOf = (sq: Square): number => sq >> 3;
export const sq = (file: number, rank: number): Square => rank * 8 + file;

export function squareName(s: Square): string {
  return 'abcdefgh'[fileOf(s)] + String(rankOf(s) + 1);
}

export function parseSquare(name: string): Square | null {
  if (!/^[a-h][1-8]$/.test(name)) return null;
  return sq(name.charCodeAt(0) - 97, name.charCodeAt(1) - 49);
}

/** Notação UCI do lance (ex.: e2e4, e7e8q). Usada no protocolo de rede. */
export function moveToUci(m: Move): string {
  return squareName(m.from) + squareName(m.to) + (m.promotion ?? '');
}
