import { applyMove, inCheck, legalMoves } from './position';
import { type Move, type Position, fileOf, rankOf, squareName } from './types';

/** Notação algébrica padrão (SAN) do lance `m`, que deve ser legal em `pos`. */
export function toSan(pos: Position, m: Move): string {
  let san: string;
  if (m.castle) {
    san = m.castle === 'k' ? 'O-O' : 'O-O-O';
  } else if (m.piece.type === 'p') {
    san = m.captured ? 'abcdefgh'[fileOf(m.from)] + 'x' : '';
    san += squareName(m.to);
    if (m.promotion) san += '=' + m.promotion.toUpperCase();
  } else {
    san = m.piece.type.toUpperCase();
    // Desambiguação: outras peças do mesmo tipo que podem ir para a mesma casa.
    const rivals = legalMoves(pos).filter(
      (o) => o.to === m.to && o.from !== m.from && o.piece.type === m.piece.type,
    );
    if (rivals.length) {
      const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
      const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
      if (!sameFile) san += 'abcdefgh'[fileOf(m.from)];
      else if (!sameRank) san += String(rankOf(m.from) + 1);
      else san += squareName(m.from);
    }
    if (m.captured) san += 'x';
    san += squareName(m.to);
  }
  const next = applyMove(pos, m);
  if (inCheck(next)) san += legalMoves(next).length === 0 ? '#' : '+';
  return san;
}
