import { describe, expect, it } from 'vitest';
import { Game, START_FEN, legalMoves, parseFen, perft, toFen } from './index';

/** Joga uma sequência de lances UCI, falhando o teste se algum for ilegal. */
function playAll(game: Game, ucis: string): Game {
  for (const uci of ucis.split(/\s+/).filter(Boolean)) {
    expect(game.playUci(uci), `lance ${uci} deveria ser legal`).not.toBeNull();
  }
  return game;
}

describe('perft (validação do gerador de lances)', () => {
  const cases: [string, string, number[]][] = [
    ['posição inicial', START_FEN, [20, 400, 8902, 197281]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['posição 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['posição 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['posição 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['posição 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
  ];
  for (const [name, fen, counts] of cases) {
    it(name, () => {
      const pos = parseFen(fen);
      counts.forEach((n, i) => expect(perft(pos, i + 1), `profundidade ${i + 1}`).toBe(n));
    });
  }
});

describe('FEN', () => {
  it('ida e volta', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R b Kq e3 3 17';
    expect(toFen(parseFen(fen))).toBe(fen);
  });
});

describe('roque', () => {
  it('pequeno e grande para as brancas, com torre no lugar certo', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(g.playUci('e1g1')!.san).toBe('O-O');
    expect(toFen(g.position).split(' ')[0]).toBe('r3k2r/8/8/8/8/8/8/R4RK1');
    expect(g.playUci('e8c8')!.san).toBe('O-O-O');
    expect(toFen(g.position).split(' ').slice(0, 3).join(' ')).toBe('2kr3r/8/8/8/8/8/8/R4RK1 w -');
  });

  it('proibido em xeque, atravessando casa atacada ou com caminho ocupado', () => {
    // Rei em xeque pela torre em e8.
    expect(new Game('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').playUci('e1g1')).toBeNull();
    // f1 atacada pelo bispo em c4.
    expect(new Game('6k1/8/8/8/2b5/8/8/R3K2R w KQ - 0 1').playUci('e1g1')).toBeNull();
    // d1 atacada pela torre em d8 (grande proibido), pequeno permitido.
    const g = new Game('3r2k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(g.playUci('e1c1')).toBeNull();
    expect(g.playUci('e1g1')).not.toBeNull();
    // b1 ocupada impede o grande, mesmo sem ataque.
    expect(new Game('6k1/8/8/8/8/8/8/RN2K2R w KQ - 0 1').playUci('e1c1')).toBeNull();
    // b1 atacada NÃO impede o grande (só o rei não pode passar por casa atacada).
    expect(new Game('1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').playUci('e1c1')).not.toBeNull();
  });

  it('perde o direito ao mover rei ou torre, ou quando a torre é capturada', () => {
    const g = playAll(new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'h1h2 a8a7 h2h1 a7a8');
    expect(g.playUci('e1g1')).toBeNull();
    expect(g.playUci('e1c1')).not.toBeNull();
    expect(g.playUci('e8c8')).toBeNull();
    const g2 = playAll(new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'a1a8');
    expect(toFen(g2.position).split(' ')[2]).toBe('Kk');
  });
});

describe('en passant', () => {
  it('captura logo após o avanço duplo e remove o peão', () => {
    const g = playAll(new Game(), 'e2e4 a7a6 e4e5 d7d5');
    const pm = g.playUci('e5d6')!;
    expect(pm.san).toBe('exd6');
    expect(pm.move.enPassant).toBe(true);
    expect(g.position.board[35]).toBeNull(); // d5 vazia
  });

  it('só vale no lance imediatamente seguinte', () => {
    const g = playAll(new Game(), 'e2e4 a7a6 e4e5 d7d5 h2h3 h7h6');
    expect(g.playUci('e5d6')).toBeNull();
  });

  it('não pode expor o próprio rei (cravada horizontal)', () => {
    const g = new Game('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1');
    expect(g.playUci('e5d6')).toBeNull();
  });
});

describe('promoção', () => {
  it('gera as quatro opções e aplica a peça escolhida', () => {
    const pos = parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const promos = legalMoves(pos).filter((m) => m.from === 48 && m.to === 56).map((m) => m.promotion);
    expect(promos.sort()).toEqual(['b', 'n', 'q', 'r']);
    const g = new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(g.playUci('a7a8n')!.san).toBe('a8=N');
    expect(g.position.board[56]).toEqual({ color: 'w', type: 'n' });
  });

  it('sem peça indicada o lance não é aceito', () => {
    expect(new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1').playUci('a7a8')).toBeNull();
  });

  it('promoção com captura e xeque', () => {
    const g = new Game('1r5k/P7/8/8/8/8/8/K7 w - - 0 1');
    expect(g.playUci('a7b8q')!.san).toBe('axb8=Q+');
  });
});

describe('fim de partida', () => {
  it('mate do pastor', () => {
    const g = playAll(new Game(), 'e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7');
    expect(g.history.at(-1)!.san).toBe('Qxf7#');
    expect(g.result).toEqual({ winner: 'w', reason: 'checkmate' });
    expect(g.legalMoves()).toHaveLength(0);
    expect(g.playUci('e8f7')).toBeNull();
  });

  it('afogamento', () => {
    const g = new Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(g.result).toEqual({ winner: null, reason: 'stalemate' });
    const g2 = new Game('7k/8/5QK1/8/8/8/8/8 w - - 0 1');
    g2.playUci('f6f7');
    expect(g2.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('tripla repetição', () => {
    const g = playAll(new Game(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1');
    expect(g.isOver).toBe(false);
    g.playUci('f6g8');
    expect(g.result).toEqual({ winner: null, reason: 'threefold' });
  });

  it('regra dos 50 lances', () => {
    const g = new Game('8/8/8/8/8/2k5/8/K6R w - - 99 80');
    expect(g.isOver).toBe(false);
    g.playUci('h1h2');
    expect(g.result).toEqual({ winner: null, reason: 'fifty-moves' });
  });

  it('mate no 100º meio-lance prevalece sobre os 50 lances', () => {
    const g = new Game('k7/8/1K6/8/8/8/8/7R w - - 99 80');
    g.playUci('h1h8');
    expect(g.result).toEqual({ winner: 'w', reason: 'checkmate' });
  });

  it('material insuficiente', () => {
    expect(new Game('8/8/8/4k3/8/8/8/4K3 w - - 0 1').result?.reason).toBe('insufficient');
    expect(new Game('8/8/8/4k3/8/8/8/3NK3 w - - 0 1').result?.reason).toBe('insufficient');
    expect(new Game('8/8/8/4k3/8/8/8/3BK3 w - - 0 1').result?.reason).toBe('insufficient');
    // Bispos na mesma cor de casa: empate.
    expect(new Game('8/8/2b5/4k3/8/8/8/3BK3 w - - 0 1').result?.reason).toBe('insufficient');
    // Bispos em cores diferentes, dois cavalos ou peão: segue.
    expect(new Game('8/8/3b4/4k3/8/8/8/3BK3 w - - 0 1').isOver).toBe(false);
    expect(new Game('8/8/8/4k3/8/8/8/2NNK3 w - - 0 1').isOver).toBe(false);
    expect(new Game('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1').isOver).toBe(false);
    // Captura que leva a K x K encerra.
    const g = new Game('8/8/8/4k3/8/6n1/8/4K2Q b - - 0 1');
    expect(g.isOver).toBe(false);
    g.playUci('g3h1');
    expect(g.result).toEqual({ winner: null, reason: 'insufficient' });
  });

  it('queda de bandeira: perde, ou empata se o adversário não tem material para mate', () => {
    expect(new Game().timeoutResult('w')).toEqual({ winner: 'b', reason: 'timeout' });
    const g = new Game('8/8/8/4k3/8/8/4P3/2N1K3 w - - 0 1');
    expect(g.timeoutResult('w')).toEqual({ winner: null, reason: 'timeout-insufficient' });
    expect(new Game('8/8/8/4k3/8/8/8/3NK2q w - - 0 1').timeoutResult('b')).toEqual({ winner: null, reason: 'timeout-insufficient' });
    expect(new Game('8/8/8/4k3/8/8/8/3NK2q w - - 0 1').timeoutResult('w')).toEqual({ winner: 'b', reason: 'timeout' });
  });
});

describe('SAN', () => {
  it('desambigua por coluna, fileira e casa', () => {
    const g = new Game('7k/8/8/8/8/8/8/R4R1K w - - 0 1');
    expect(g.playUci('a1d1')!.san).toBe('Rad1');
    const g2 = new Game('7k/8/8/R7/8/8/8/R6K w - - 0 1');
    expect(g2.playUci('a1a3')!.san).toBe('R1a3');
    const g3 = new Game('7k/8/8/8/8/Q1Q5/8/Q6K w - - 0 1');
    expect(g3.playUci('a3b2')!.san).toBe('Qa3b2+');
  });
});

describe('peças capturadas', () => {
  it('conta por cor', () => {
    const g = playAll(new Game(), 'e2e4 d7d5 e4d5 d8d5');
    expect(g.captured().b.map((p) => p.type)).toEqual(['p']);
    expect(g.captured().w.map((p) => p.type)).toEqual(['p']);
  });
});
