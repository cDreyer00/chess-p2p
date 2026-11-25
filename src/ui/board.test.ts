// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Game, parseSquare } from '../chess';
import { BoardView } from './board';

const SIZE = 800;

function setup(fen?: string, orientation: 'w' | 'b' = 'w') {
  const game = new Game(fen);
  const moves: string[] = [];
  const view = new BoardView((uci) => moves.push(uci));
  document.body.replaceChildren(view.el);
  view.el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, x: 0, y: 0 }) as DOMRect;
  const update = () =>
    view.update({
      position: game.position,
      orientation,
      lastMove: game.lastMove,
      inCheck: game.inCheck(),
      legalMoves: game.legalMoves(),
    });
  update();
  const point = (name: string) => {
    const s = parseSquare(name)!;
    const file = s & 7;
    const rank = s >> 3;
    const col = orientation === 'w' ? file : 7 - file;
    const row = orientation === 'w' ? 7 - rank : rank;
    return { clientX: col * 100 + 50, clientY: row * 100 + 50 };
  };
  const fire = (type: string, name: string, target: EventTarget = view.el) =>
    target.dispatchEvent(new PointerEvent(type, { ...point(name), button: 0, bubbles: true }));
  const click = (name: string) => {
    fire('pointerdown', name);
    fire('pointerup', name, window);
  };
  const cell = (name: string) => view.el.querySelector<HTMLElement>(`[data-square="${name}"]`)!;
  return { view, moves, click, fire, cell, update };
}

describe('BoardView', () => {
  beforeEach(() => document.body.replaceChildren());

  it('desenha 32 peças e coordenadas', () => {
    const { view } = setup();
    expect(view.el.querySelectorAll('img.piece')).toHaveLength(32);
    expect(view.el.querySelectorAll('.coord')).toHaveLength(16);
  });

  it('clique na peça destaca os lances legais e clique no destino move', () => {
    const { moves, click, cell } = setup();
    click('e2');
    expect(cell('e2').classList.contains('selected')).toBe(true);
    expect(cell('e3').classList.contains('target')).toBe(true);
    expect(cell('e4').classList.contains('target')).toBe(true);
    expect(cell('e5').classList.contains('target')).toBe(false);
    click('e4');
    expect(moves).toEqual(['e2e4']);
  });

  it('arrastar e soltar move', () => {
    const { moves, fire } = setup();
    fire('pointerdown', 'g1');
    fire('pointermove', 'f2', window);
    fire('pointermove', 'f3', window);
    fire('pointerup', 'f3', window);
    expect(moves).toEqual(['g1f3']);
    expect(document.querySelector('.ghost')).toBeNull();
  });

  it('soltar em casa ilegal não move', () => {
    const { moves, fire } = setup();
    fire('pointerdown', 'g1');
    fire('pointermove', 'g4', window);
    fire('pointerup', 'g4', window);
    expect(moves).toEqual([]);
  });

  it('tabuleiro invertido para as pretas', () => {
    const { view, moves, click } = setup('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 'b');
    // Primeira casa na tela (canto superior esquerdo) é h1 para as pretas.
    expect(view.el.querySelector('.sq')!.getAttribute('data-square')).toBe('h1');
    click('e7');
    click('e5');
    expect(moves).toEqual(['e7e5']);
  });

  it('promoção abre a escolha de peça', () => {
    const { view, moves, click } = setup('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    click('a7');
    click('a8');
    const box = view.el.querySelector('.promotion')!;
    expect(box).not.toBeNull();
    const buttons = box.querySelectorAll<HTMLButtonElement>('.promotion-row button');
    expect(buttons).toHaveLength(4);
    buttons[3].click(); // cavalo
    expect(moves).toEqual(['a7a8n']);
    expect(view.el.querySelector('.promotion')).toBeNull();
  });

  it('marca o último lance e o rei em xeque', () => {
    const game = new Game();
    for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) game.playUci(m);
    const view = new BoardView(() => {});
    view.update({ position: game.position, orientation: 'w', lastMove: game.lastMove, inCheck: true, legalMoves: [] });
    const cell = (n: string) => view.el.querySelector(`[data-square="${n}"]`)!;
    expect(cell('e1').classList.contains('check')).toBe(true);
    expect(cell('d8').classList.contains('last')).toBe(true);
    expect(cell('h4').classList.contains('last')).toBe(true);
  });
});
