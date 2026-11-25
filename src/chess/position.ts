import {
  type CastlingRights,
  type Color,
  type Move,
  type Piece,
  type PieceType,
  type Position,
  type PromotionPiece,
  type Square,
  fileOf,
  opposite,
  parseSquare,
  rankOf,
  sq,
  squareName,
} from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_TYPES: readonly PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const PROMOTIONS: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

// ---------------------------------------------------------------------------
// FEN

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error(`FEN inválida: ${fen}`);
  const [placement, turn, castling, ep, half = '0', full = '1'] = parts;
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`FEN inválida (fileiras): ${fen}`);
  const board: (Piece | null)[] = new Array(64).fill(null);
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        const type = ch.toLowerCase() as PieceType;
        if (!PIECE_TYPES.includes(type) || file > 7) throw new Error(`FEN inválida (peça): ${fen}`);
        board[sq(file, rank)] = { type, color: ch === ch.toUpperCase() ? 'w' : 'b' };
        file++;
      }
    }
    if (file !== 8) throw new Error(`FEN inválida (colunas): ${fen}`);
  });
  if (turn !== 'w' && turn !== 'b') throw new Error(`FEN inválida (vez): ${fen}`);
  return {
    board,
    turn,
    castling: {
      wk: castling.includes('K'),
      wq: castling.includes('Q'),
      bk: castling.includes('k'),
      bq: castling.includes('q'),
    },
    ep: ep === '-' ? null : parseSquare(ep),
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1,
  };
}

function placementFen(pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[sq(file, rank)];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += String(empty);
      empty = 0;
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

function castlingFen(c: CastlingRights): string {
  const s = (c.wk ? 'K' : '') + (c.wq ? 'Q' : '') + (c.bk ? 'k' : '') + (c.bq ? 'q' : '');
  return s || '-';
}

export function toFen(pos: Position): string {
  return [
    placementFen(pos),
    pos.turn,
    castlingFen(pos.castling),
    pos.ep === null ? '-' : squareName(pos.ep),
    pos.halfmove,
    pos.fullmove,
  ].join(' ');
}

/**
 * Chave para detectar repetição: peças, vez, roque e en passant (este só quando
 * existe captura en passant legal, como manda a regra da FIDE).
 */
export function repetitionKey(pos: Position): string {
  const epLegal = pos.ep !== null && legalMoves(pos).some((m) => m.enPassant);
  return [placementFen(pos), pos.turn, castlingFen(pos.castling), epLegal ? squareName(pos.ep!) : '-'].join(' ');
}

// ---------------------------------------------------------------------------
// Ataques

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
] as const;
const KING_STEPS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
] as const;
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function offset(s: Square, df: number, dr: number): Square | null {
  const f = fileOf(s) + df;
  const r = rankOf(s) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? null : sq(f, r);
}

/** A casa `target` é atacada por alguma peça da cor `by`? */
export function isSquareAttacked(board: ReadonlyArray<Piece | null>, target: Square, by: Color): boolean {
  // Peões: olhamos "para trás" a partir do alvo.
  const pawnDr = by === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const s = offset(target, df, pawnDr);
    const p = s === null ? null : board[s];
    if (p && p.color === by && p.type === 'p') return true;
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    const s = offset(target, df, dr);
    const p = s === null ? null : board[s];
    if (p && p.color === by && p.type === 'n') return true;
  }
  for (const [df, dr] of KING_STEPS) {
    const s = offset(target, df, dr);
    const p = s === null ? null : board[s];
    if (p && p.color === by && p.type === 'k') return true;
  }
  const slide = (dirs: ReadonlyArray<readonly [number, number]>, types: PieceType[]): boolean => {
    for (const [df, dr] of dirs) {
      let s = offset(target, df, dr);
      while (s !== null) {
        const p = board[s];
        if (p) {
          if (p.color === by && types.includes(p.type)) return true;
          break;
        }
        s = offset(s, df, dr);
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, ['r', 'q']) || slide(BISHOP_DIRS, ['b', 'q']);
}

export function kingSquare(board: ReadonlyArray<Piece | null>, color: Color): Square | null {
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.type === 'k' && p.color === color) return s;
  }
  return null;
}

export function inCheck(pos: Position, color: Color = pos.turn): boolean {
  const k = kingSquare(pos.board, color);
  return k !== null && isSquareAttacked(pos.board, k, opposite(color));
}

// ---------------------------------------------------------------------------
// Geração de lances

function pseudoLegalMoves(pos: Position): Move[] {
  const moves: Move[] = [];
  const { board, turn } = pos;
  const enemy = opposite(turn);

  const add = (from: Square, to: Square, extra: Partial<Move> = {}) => {
    const piece = board[from]!;
    const captured = extra.enPassant ? { color: enemy, type: 'p' as const } : board[to] ?? undefined;
    const base: Move = { from, to, piece, ...(captured ? { captured } : {}), ...extra };
    moves.push(base);
  };

  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (!p || p.color !== turn) continue;

    switch (p.type) {
      case 'p': {
        const dir = turn === 'w' ? 1 : -1;
        const startRank = turn === 'w' ? 1 : 6;
        const lastRank = turn === 'w' ? 7 : 0;
        const pushPawn = (to: Square, extra: Partial<Move> = {}) => {
          if (rankOf(to) === lastRank) {
            for (const promotion of PROMOTIONS) add(from, to, { ...extra, promotion });
          } else {
            add(from, to, extra);
          }
        };
        const one = offset(from, 0, dir);
        if (one !== null && !board[one]) {
          pushPawn(one);
          const two = offset(from, 0, 2 * dir);
          if (rankOf(from) === startRank && two !== null && !board[two]) add(from, two);
        }
        for (const df of [-1, 1]) {
          const to = offset(from, df, dir);
          if (to === null) continue;
          const target = board[to];
          if (target && target.color === enemy) pushPawn(to);
          else if (to === pos.ep && !target) add(from, to, { enPassant: true });
        }
        break;
      }
      case 'n':
      case 'k': {
        const steps = p.type === 'n' ? KNIGHT_STEPS : KING_STEPS;
        for (const [df, dr] of steps) {
          const to = offset(from, df, dr);
          if (to === null) continue;
          const target = board[to];
          if (!target || target.color === enemy) add(from, to);
        }
        if (p.type === 'k') addCastling(pos, from, add);
        break;
      }
      default: {
        const dirs =
          p.type === 'r' ? ROOK_DIRS : p.type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
        for (const [df, dr] of dirs) {
          let to = offset(from, df, dr);
          while (to !== null) {
            const target = board[to];
            if (target) {
              if (target.color === enemy) add(from, to);
              break;
            }
            add(from, to);
            to = offset(to, df, dr);
          }
        }
      }
    }
  }
  return moves;
}

function addCastling(
  pos: Position,
  from: Square,
  add: (from: Square, to: Square, extra?: Partial<Move>) => void,
): void {
  const { board, turn, castling } = pos;
  const rank = turn === 'w' ? 0 : 7;
  if (from !== sq(4, rank)) return;
  const enemy = opposite(turn);
  const canK = turn === 'w' ? castling.wk : castling.bk;
  const canQ = turn === 'w' ? castling.wq : castling.bq;
  if (!canK && !canQ) return;
  if (isSquareAttacked(board, from, enemy)) return; // não pode rocar em xeque
  const rookAt = (file: number) => {
    const r = board[sq(file, rank)];
    return r && r.type === 'r' && r.color === turn;
  };
  if (
    canK &&
    rookAt(7) &&
    !board[sq(5, rank)] &&
    !board[sq(6, rank)] &&
    !isSquareAttacked(board, sq(5, rank), enemy) &&
    !isSquareAttacked(board, sq(6, rank), enemy)
  ) {
    add(from, sq(6, rank), { castle: 'k' });
  }
  if (
    canQ &&
    rookAt(0) &&
    !board[sq(1, rank)] &&
    !board[sq(2, rank)] &&
    !board[sq(3, rank)] &&
    !isSquareAttacked(board, sq(3, rank), enemy) &&
    !isSquareAttacked(board, sq(2, rank), enemy)
  ) {
    add(from, sq(2, rank), { castle: 'q' });
  }
}

/** Aplica o lance (sem checar legalidade) e devolve a nova posição. */
export function applyMove(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const { turn } = pos;
  const rank = turn === 'w' ? 0 : 7;

  board[m.from] = null;
  board[m.to] = m.promotion ? { color: turn, type: m.promotion } : m.piece;
  if (m.enPassant) board[m.to + (turn === 'w' ? -8 : 8)] = null;
  if (m.castle === 'k') {
    board[sq(5, rank)] = board[sq(7, rank)];
    board[sq(7, rank)] = null;
  } else if (m.castle === 'q') {
    board[sq(3, rank)] = board[sq(0, rank)];
    board[sq(0, rank)] = null;
  }

  let { wk, wq, bk, bq } = pos.castling;
  const touch = (s: Square) => {
    if (s === 4) wk = wq = false;
    if (s === 60) bk = bq = false;
    if (s === 0) wq = false;
    if (s === 7) wk = false;
    if (s === 56) bq = false;
    if (s === 63) bk = false;
  };
  touch(m.from);
  touch(m.to);

  const doublePush = m.piece.type === 'p' && Math.abs(m.to - m.from) === 16;
  return {
    board,
    turn: opposite(turn),
    castling: { wk, wq, bk, bq },
    ep: doublePush ? (m.from + m.to) / 2 : null,
    halfmove: m.piece.type === 'p' || m.captured ? 0 : pos.halfmove + 1,
    fullmove: turn === 'b' ? pos.fullmove + 1 : pos.fullmove,
  };
}

export function legalMoves(pos: Position): Move[] {
  return pseudoLegalMoves(pos).filter((m) => !inCheck(applyMove(pos, m), pos.turn));
}

/** Contagem perft (número de folhas a uma profundidade), usada para validar o gerador. */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(applyMove(pos, m), depth - 1);
  return n;
}

/** Encontra o lance legal que corresponde à notação UCI, ou null se não for legal. */
export function findMoveByUci(pos: Position, uci: string): Move | null {
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  const promo = uci.slice(4) || undefined;
  if (from === null || to === null) return null;
  return legalMoves(pos).find((m) => m.from === from && m.to === to && m.promotion === promo) ?? null;
}

// ---------------------------------------------------------------------------
// Material

/**
 * A cor `color` tem material suficiente, em tese, para dar mate?
 * Aproximação usada na queda de bandeira: só rei, rei + bispo ou rei + cavalo não bastam.
 */
export function canMate(board: ReadonlyArray<Piece | null>, color: Color): boolean {
  let minors = 0;
  for (const p of board) {
    if (!p || p.color !== color || p.type === 'k') continue;
    if (p.type === 'p' || p.type === 'r' || p.type === 'q') return true;
    minors++;
  }
  return minors >= 2;
}

/**
 * Material insuficiente para qualquer lado dar mate: K x K, K+menor x K,
 * ou só reis e bispos todos na mesma cor de casa.
 */
export function isInsufficientMaterial(board: ReadonlyArray<Piece | null>): boolean {
  const others: { piece: Piece; square: Square }[] = [];
  board.forEach((p, s) => {
    if (p && p.type !== 'k') others.push({ piece: p, square: s });
  });
  if (others.length === 0) return true;
  if (others.some(({ piece }) => piece.type === 'p' || piece.type === 'r' || piece.type === 'q')) return false;
  if (others.length === 1) return true; // um único cavalo ou bispo
  if (others.every(({ piece }) => piece.type === 'b')) {
    const shade = (s: Square) => (fileOf(s) + rankOf(s)) % 2;
    const first = shade(others[0].square);
    return others.every(({ square }) => shade(square) === first);
  }
  return false;
}
