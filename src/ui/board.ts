import {
  type Color,
  type Move,
  type Piece,
  type Position,
  type PromotionPiece,
  type Square,
  fileOf,
  kingSquare,
  rankOf,
  sq,
  squareName,
} from '../chess';

export const pieceUrl = (p: Piece): string =>
  `${import.meta.env.BASE_URL}pieces/${p.color}${p.type.toUpperCase()}.svg`;

export interface BoardState {
  position: Position;
  orientation: Color;
  lastMove: Move | null;
  inCheck: boolean;
  /** Lances que o jogador local pode fazer agora (vazio = tabuleiro bloqueado). */
  legalMoves: Move[];
}

/** Tabuleiro interativo: clicar ou arrastar para mover. Só conhece a posição e os lances legais. */
export class BoardView {
  readonly el: HTMLElement;
  private readonly squares: HTMLElement[] = [];
  private state: BoardState | null = null;
  private selected: Square | null = null;
  private drag: { from: Square; ghost: HTMLElement; startX: number; startY: number; moved: boolean } | null = null;
  private promo: HTMLElement | null = null;

  constructor(private readonly onMove: (uci: string) => void) {
    this.el = document.createElement('div');
    this.el.className = 'board';
    for (let i = 0; i < 64; i++) {
      const cell = document.createElement('div');
      cell.className = 'sq';
      this.el.appendChild(cell);
      this.squares.push(cell);
    }
    this.el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(state: BoardState): void {
    const prev = this.state;
    this.state = state;
    // Se a posição mudou (lance do adversário, ressincronização), desfaz seleção inválida.
    if (prev && prev.position !== state.position) {
      this.closePromotion();
      if (this.selected !== null && !this.movesFrom(this.selected).length) this.selected = null;
      if (this.drag && !this.movesFrom(this.drag.from).length) this.cancelDrag();
    }
    if (!state.legalMoves.length) {
      this.selected = null;
      this.cancelDrag();
    }
    this.render();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const flip = s.orientation === 'b';
    const targets = new Map<Square, Move>();
    const from = this.drag?.from ?? this.selected;
    if (from !== null) for (const m of this.movesFrom(from)) targets.set(m.to, m);
    const checkSq = s.inCheck ? kingSquare(s.position.board, s.position.turn) : null;

    for (let i = 0; i < 64; i++) {
      // i percorre a tela da esquerda para a direita, de cima para baixo.
      const row = Math.floor(i / 8);
      const col = i % 8;
      const square = flip ? sq(7 - col, row) : sq(col, 7 - row);
      const cell = this.squares[i];
      const piece = s.position.board[square];
      const cls = ['sq', (fileOf(square) + rankOf(square)) % 2 ? 'light' : 'dark'];
      if (s.lastMove && (s.lastMove.from === square || s.lastMove.to === square)) cls.push('last');
      if (square === from) cls.push('selected');
      if (square === checkSq) cls.push('check');
      const target = targets.get(square);
      if (target) cls.push(piece || target.enPassant ? 'capture' : 'target');
      if (this.drag?.from === square) cls.push('dragging');
      cell.className = cls.join(' ');
      cell.dataset.square = squareName(square);

      let html = '';
      if (piece) html += `<img class="piece" draggable="false" alt="${piece.color}${piece.type}" src="${pieceUrl(piece)}">`;
      if (row === 7) html += `<span class="coord file">${'abcdefgh'[fileOf(square)]}</span>`;
      if (col === 0) html += `<span class="coord rank">${rankOf(square) + 1}</span>`;
      if (cell.innerHTML !== html) cell.innerHTML = html;
    }
  }

  private movesFrom(from: Square): Move[] {
    return this.state ? this.state.legalMoves.filter((m) => m.from === from) : [];
  }

  /** Casa sob o ponteiro, considerando a orientação. */
  private squareAt(x: number, y: number): Square | null {
    const r = this.el.getBoundingClientRect();
    const col = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.state?.orientation === 'b' ? sq(7 - col, row) : sq(col, 7 - row);
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.state || e.button !== 0 || this.promo) return;
    const square = this.squareAt(e.clientX, e.clientY);
    if (square === null) return;
    e.preventDefault();

    // Clique numa casa de destino com peça selecionada: move.
    if (this.selected !== null && this.selected !== square && this.tryMove(this.selected, square)) return;

    if (this.movesFrom(square).length) {
      const img = this.squares.find((c) => c.dataset.square === squareName(square))?.querySelector('img');
      const ghost = document.createElement('img');
      ghost.src = img?.getAttribute('src') ?? '';
      ghost.className = 'ghost';
      const size = this.el.getBoundingClientRect().width / 8;
      ghost.style.width = ghost.style.height = `${size}px`;
      ghost.style.display = 'none';
      document.body.appendChild(ghost);
      this.drag = { from: square, ghost, startX: e.clientX, startY: e.clientY, moved: false };
      this.selected = square;
      this.render();
    } else {
      this.selected = null;
      this.render();
    }
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    d.moved = true;
    const size = parseFloat(d.ghost.style.width);
    d.ghost.style.display = 'block';
    d.ghost.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
    this.squares.forEach((c) => c.classList.toggle('hover', false));
    const over = this.squareAt(e.clientX, e.clientY);
    if (over !== null) this.squares.find((c) => c.dataset.square === squareName(over))?.classList.add('hover');
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const to = this.squareAt(e.clientX, e.clientY);
    const wasDrag = d.moved;
    this.cancelDrag();
    if (to !== null && to !== d.from && this.tryMove(d.from, to)) return;
    // Soltou fora de uma casa válida depois de arrastar: desfaz a seleção.
    if (wasDrag && to !== d.from) this.selected = null;
    this.render();
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    this.drag.ghost.remove();
    this.drag = null;
    this.squares.forEach((c) => c.classList.remove('hover'));
  }

  private tryMove(from: Square, to: Square): boolean {
    const candidates = this.movesFrom(from).filter((m) => m.to === to);
    if (!candidates.length) return false;
    this.selected = null;
    if (candidates[0].promotion) {
      this.askPromotion(candidates[0], (p) => this.onMove(squareName(from) + squareName(to) + p));
    } else {
      this.onMove(squareName(from) + squareName(to));
    }
    this.render();
    return true;
  }

  private askPromotion(move: Move, done: (p: PromotionPiece) => void): void {
    this.closePromotion();
    const box = document.createElement('div');
    box.className = 'promotion';
    box.innerHTML = '<div class="promotion-title">Promover para</div>';
    const row = document.createElement('div');
    row.className = 'promotion-row';
    for (const type of ['q', 'r', 'b', 'n'] as PromotionPiece[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = { q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo' }[type];
      b.innerHTML = `<img src="${pieceUrl({ color: move.piece.color, type })}" alt="${b.title}">`;
      b.addEventListener('click', () => {
        this.closePromotion();
        done(type);
      });
      row.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'link';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => this.closePromotion());
    box.append(row, cancel);
    this.el.appendChild(box);
    this.promo = box;
  }

  private closePromotion(): void {
    this.promo?.remove();
    this.promo = null;
  }
}
