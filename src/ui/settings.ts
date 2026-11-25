/**
 * Preferências visuais (estilo das peças e do tabuleiro), salvas no localStorage.
 * Sem relação com a partida: cada jogador escolhe o próprio visual.
 */

export interface PieceSet {
  id: string;
  name: string;
  author: string;
  license: string;
}

export interface BoardTheme {
  id: string;
  name: string;
  /** Cores sólidas das casas (usadas também nas coordenadas e na promoção). */
  light: string;
  dark: string;
  /** Fundo das casas; aceita camadas CSS (gradientes) terminando numa cor. Padrão: a cor sólida. */
  lightBg?: string;
  darkBg?: string;
  /** Camada translúcida sobre as casas do último lance. */
  last: string;
}

/** Pastas em `public/pieces/<id>/`, com `wK.svg`, `bQ.svg` etc. A primeira é o padrão. */
export const PIECE_SETS: readonly PieceSet[] = [
  { id: 'classico', name: 'Clássico', author: 'Colin M.L. Burnett', license: 'BSD' },
  { id: 'merida', name: 'Merida', author: 'Armando Hernandez Marroquin', license: 'GPLv2+' },
  { id: 'chessnut', name: 'Chessnut', author: 'Alexis Luengas', license: 'Apache 2.0' },
  { id: 'fantasy', name: 'Fantasia', author: 'Maurizio Monge', license: 'MIT' },
  { id: 'spatial', name: 'Espacial', author: 'Maurizio Monge', license: 'MIT' },
  { id: 'celtic', name: 'Celta', author: 'Maurizio Monge', license: 'MIT' },
  { id: 'rhosgfx', name: 'Desenho', author: 'RhosGFX', license: 'CC0 1.0' },
  { id: 'totoy', name: 'Totoy', author: 'Kosal Sen', license: 'CC BY 4.0' },
  { id: 'papercut', name: 'Recorte', author: 'Nikolay Anzarov', license: 'CC BY 4.0' },
  { id: 'kiwen-suwi', name: 'Kiwen Suwi', author: 'neverRare', license: 'CC BY 4.0' },
  { id: 'shapes', name: 'Formas', author: 'flugsio', license: 'CC BY-SA 4.0' },
];

const WOOD_GRAIN =
  'repeating-linear-gradient(97deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 7px, rgba(255,255,255,0.05) 7px 9px, transparent 9px 15px)';
const MARBLE_VEINS =
  'linear-gradient(125deg, transparent 30%, rgba(0,0,0,0.07) 33%, transparent 37%, transparent 62%, rgba(0,0,0,0.05) 65%, transparent 69%)';

/** A primeira é o padrão. */
export const BOARD_THEMES: readonly BoardTheme[] = [
  { id: 'verde', name: 'Verde', light: '#eeeed2', dark: '#769656', last: 'rgba(246, 246, 105, 0.55)' },
  { id: 'marrom', name: 'Marrom', light: '#f0d9b5', dark: '#b58863', last: 'rgba(205, 210, 106, 0.6)' },
  { id: 'azul', name: 'Azul', light: '#dee3e6', dark: '#8ca2ad', last: 'rgba(155, 199, 0, 0.45)' },
  { id: 'grafite', name: 'Grafite', light: '#c9c9c9', dark: '#6b6b6b', last: 'rgba(120, 170, 255, 0.45)' },
  { id: 'roxo', name: 'Roxo', light: '#e9e1f3', dark: '#8b6fb0', last: 'rgba(255, 214, 102, 0.55)' },
  { id: 'coral', name: 'Coral', light: '#fbe3d4', dark: '#de7d63', last: 'rgba(255, 240, 120, 0.55)' },
  { id: 'oceano', name: 'Oceano', light: '#d4eef0', dark: '#2f7f8f', last: 'rgba(255, 230, 100, 0.5)' },
  { id: 'areia', name: 'Areia', light: '#f5e6c4', dark: '#c8a46b', last: 'rgba(150, 200, 90, 0.5)' },
  {
    id: 'madeira',
    name: 'Madeira',
    light: '#e7c79a',
    dark: '#9c6133',
    lightBg: `${WOOD_GRAIN}, linear-gradient(160deg, #ecd0a6, #dfba88)`,
    darkBg: `${WOOD_GRAIN}, linear-gradient(160deg, #a66a3a, #8d552b)`,
    last: 'rgba(255, 235, 120, 0.45)',
  },
  {
    id: 'marmore',
    name: 'Mármore',
    light: '#eeeeec',
    dark: '#8f959c',
    lightBg: `${MARBLE_VEINS}, radial-gradient(circle at 30% 30%, #fafaf8, #e2e2df)`,
    darkBg: `${MARBLE_VEINS}, radial-gradient(circle at 30% 30%, #a0a6ad, #7d838a)`,
    last: 'rgba(130, 190, 255, 0.45)',
  },
  { id: 'noite', name: 'Noite', light: '#7a7f9a', dark: '#3b3f58', last: 'rgba(120, 220, 255, 0.4)' },
];

export interface Settings {
  pieceSet: string;
  boardTheme: string;
}

const STORAGE_KEY = 'xadrez-p2p-settings';
const DEFAULTS: Settings = { pieceSet: PIECE_SETS[0].id, boardTheme: BOARD_THEMES[0].id };

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    return {
      pieceSet: PIECE_SETS.some((p) => p.id === raw.pieceSet) ? raw.pieceSet! : DEFAULTS.pieceSet,
      boardTheme: BOARD_THEMES.some((t) => t.id === raw.boardTheme) ? raw.boardTheme! : DEFAULTS.boardTheme,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = (): Readonly<Settings> => current;

export function boardTheme(id = current.boardTheme): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...current, ...patch };
  if (!PIECE_SETS.some((p) => p.id === next.pieceSet)) next.pieceSet = DEFAULTS.pieceSet;
  if (!BOARD_THEMES.some((t) => t.id === next.boardTheme)) next.boardTheme = DEFAULTS.boardTheme;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Navegação privada sem armazenamento: vale só nesta aba.
  }
  applyBoardTheme();
  for (const fn of listeners) fn();
}

/** Registra um callback para mudanças; devolve a função que o remove. */
export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Variáveis CSS de um tema, para o documento ou para uma prévia. */
export function themeVars(t: BoardTheme): Record<string, string> {
  return {
    '--light': t.light,
    '--dark': t.dark,
    '--light-bg': t.lightBg ?? t.light,
    '--dark-bg': t.darkBg ?? t.dark,
    '--last': t.last,
  };
}

export function applyBoardTheme(el: HTMLElement = document.documentElement, t = boardTheme()): void {
  for (const [k, v] of Object.entries(themeVars(t))) el.style.setProperty(k, v);
}

export function pieceUrlFor(set: string, color: string, type: string): string {
  return `${import.meta.env.BASE_URL}pieces/${set}/${color}${type.toUpperCase()}.svg`;
}
