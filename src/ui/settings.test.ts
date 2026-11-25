// @vitest-environment happy-dom
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('configurações visuais', () => {
  it('tem 10 estilos além do padrão, com ids únicos', async () => {
    const { PIECE_SETS, BOARD_THEMES } = await import('./settings');
    expect(PIECE_SETS).toHaveLength(11);
    expect(BOARD_THEMES).toHaveLength(11);
    expect(new Set(PIECE_SETS.map((p) => p.id)).size).toBe(11);
    expect(new Set(BOARD_THEMES.map((t) => t.id)).size).toBe(11);
  });

  it('todo estilo de peças tem os 12 SVGs em public/pieces', async () => {
    const { PIECE_SETS } = await import('./settings');
    for (const set of PIECE_SETS)
      for (const c of 'wb')
        for (const t of 'KQRBNP') expect(existsSync(resolve('public/pieces', set.id, `${c}${t}.svg`)), `${set.id}/${c}${t}`).toBe(true);
  });

  it('salva a escolha, aplica o tema e troca a URL das peças', async () => {
    const s = await import('./settings');
    const { pieceUrl } = await import('./board');
    const changed = vi.fn();
    s.onSettingsChange(changed);
    s.updateSettings({ pieceSet: 'merida', boardTheme: 'madeira' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(pieceUrl({ color: 'w', type: 'n' })).toMatch(/pieces\/merida\/wN\.svg$/);
    expect(document.documentElement.style.getPropertyValue('--dark')).toBe('#9c6133');
    expect(JSON.parse(localStorage.getItem('xadrez-p2p-settings')!)).toEqual({ pieceSet: 'merida', boardTheme: 'madeira' });

    vi.resetModules();
    const again = await import('./settings');
    expect(again.getSettings()).toEqual({ pieceSet: 'merida', boardTheme: 'madeira' });
  });

  it('ignora valores salvos desconhecidos', async () => {
    localStorage.setItem('xadrez-p2p-settings', JSON.stringify({ pieceSet: 'nao-existe', boardTheme: 42 }));
    const s = await import('./settings');
    expect(s.getSettings()).toEqual({ pieceSet: 'classico', boardTheme: 'verde' });
  });

  it('painel: abre pela engrenagem, aplica a escolha e fecha com Esc', async () => {
    const { SettingsPanel } = await import('./settings-panel');
    const s = await import('./settings');
    const panel = new SettingsPanel();
    panel.button.click();
    expect(document.querySelectorAll('[data-board]')).toHaveLength(11);
    expect(document.querySelectorAll('[data-piece]')).toHaveLength(11);
    document.querySelector<HTMLElement>('[data-board="oceano"]')!.click();
    document.querySelector<HTMLElement>('[data-piece="fantasy"]')!.click();
    expect(s.getSettings()).toEqual({ pieceSet: 'fantasy', boardTheme: 'oceano' });
    expect(document.querySelector('[data-piece="fantasy"]')!.classList.contains('selected')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.settings-overlay')).toBeNull();
  });
});
