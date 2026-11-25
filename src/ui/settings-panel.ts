import {
  BOARD_THEMES,
  PIECE_SETS,
  type BoardTheme,
  applyBoardTheme,
  getSettings,
  onSettingsChange,
  pieceUrlFor,
  themeVars,
  updateSettings,
} from './settings';

const GEAR_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.03 7.03 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.05.7 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.03 7.03 0 0 0 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>`;

/** Casas da prévia (4×2) com as peças mostradas em cada uma. */
const PREVIEW = ['bR', 'bN', '', 'bK', 'wP', '', 'wQ', 'wB'];

function previewBoard(theme: BoardTheme, pieceSet: string): string {
  const style = Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const cells = PREVIEW.map((p, i) => {
    const light = (Math.floor(i / 4) + i) % 2 === 0;
    const img = p ? `<img src="${pieceUrlFor(pieceSet, p[0], p[1])}" alt="">` : '';
    return `<span class="sq ${light ? 'light' : 'dark'}">${img}</span>`;
  }).join('');
  return `<span class="preview" style="${style}">${cells}</span>`;
}

/**
 * Botão de engrenagem fixo no canto e o painel de configurações visuais.
 * Fica fora da área que o App redesenha, então vale no lobby e na partida.
 */
export class SettingsPanel {
  readonly button: HTMLButtonElement;
  private dialog: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  constructor(host: HTMLElement = document.body) {
    applyBoardTheme();
    this.button = document.createElement('button');
    this.button.className = 'settings-btn';
    this.button.title = 'Configurações';
    this.button.setAttribute('aria-label', 'Configurações');
    this.button.innerHTML = GEAR_ICON;
    this.button.addEventListener('click', () => (this.dialog ? this.close() : this.open()));
    host.appendChild(this.button);
    onSettingsChange(() => this.dialog && this.fill());
  }

  open(): void {
    if (this.dialog) return;
    const d = document.createElement('div');
    d.className = 'settings-overlay';
    d.innerHTML = `
      <div class="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><h2 id="settings-title">Configurações</h2><button class="close" aria-label="Fechar">✕</button></header>
        <section><h3>Tabuleiro</h3><div class="options boards"></div></section>
        <section><h3>Peças</h3><div class="options pieces"></div></section>
        <p class="muted small">A escolha vale só para você e fica salva neste navegador.</p>
      </div>`;
    d.addEventListener('click', (e) => {
      if (e.target === d) this.close();
    });
    d.querySelector('.close')!.addEventListener('click', () => this.close());
    d.addEventListener('click', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-board],[data-piece]');
      if (!opt) return;
      const { board, piece } = opt.dataset;
      if (board) updateSettings({ boardTheme: board });
      if (piece) updateSettings({ pieceSet: piece });
      // O conteúdo foi redesenhado: devolve o foco à opção escolhida.
      d.querySelector<HTMLElement>(board ? `[data-board="${board}"]` : `[data-piece="${piece}"]`)?.focus();
    });
    document.body.appendChild(d);
    document.addEventListener('keydown', this.onKey);
    this.dialog = d;
    this.fill();
    d.querySelector<HTMLElement>('.options .selected')?.focus();
  }

  close(): void {
    if (!this.dialog) return;
    this.dialog.remove();
    this.dialog = null;
    document.removeEventListener('keydown', this.onKey);
    this.button.focus();
  }

  private fill(): void {
    const d = this.dialog!;
    const s = getSettings();
    const option = (attr: string, id: string, selected: boolean, preview: string, label: string, title = label) =>
      `<button class="option${selected ? ' selected' : ''}" data-${attr}="${id}" aria-pressed="${selected}" title="${title}">${preview}<span class="option-name">${label}</span></button>`;
    d.querySelector('.boards')!.innerHTML = BOARD_THEMES.map((t) =>
      option('board', t.id, t.id === s.boardTheme, previewBoard(t, s.pieceSet), t.name),
    ).join('');
    const theme = BOARD_THEMES.find((t) => t.id === s.boardTheme)!;
    d.querySelector('.pieces')!.innerHTML = PIECE_SETS.map((p) =>
      option('piece', p.id, p.id === s.pieceSet, previewBoard(theme, p.id), p.name, `${p.name} — ${p.author} (${p.license})`),
    ).join('');
  }
}
