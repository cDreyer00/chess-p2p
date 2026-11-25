// @vitest-environment happy-dom
/**
 * Fluxo completo da interface com dois "navegadores" (dois App no mesmo DOM),
 * trocando a camada PeerJS por um canal em memória.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LinkHandlers } from '../net/peer';

vi.mock('../net/peer', () => {
  const hosts = new Map<string, MockHost>();
  const deliver = (to: LinkHandlers | undefined, msg: unknown) =>
    setTimeout(() => to?.onMessage(JSON.parse(JSON.stringify(msg))), 0);

  class MockHost {
    peer?: MockGuest;
    constructor(
      readonly code: string,
      readonly handlers: LinkHandlers,
    ) {
      hosts.set(code, this);
      handlers.onStatus({ kind: 'waiting' });
    }
    send(m: unknown) {
      deliver(this.peer?.handlers, m);
    }
    kick() {}
    destroy() {}
  }
  class MockGuest {
    host?: MockHost;
    constructor(
      readonly code: string,
      readonly handlers: LinkHandlers,
    ) {
      handlers.onStatus({ kind: 'connecting' });
      setTimeout(() => {
        this.host = hosts.get(code);
        if (!this.host) return handlers.onStatus({ kind: 'failed', reason: 'sala não encontrada' });
        this.host.peer = this;
        for (const h of [this.host.handlers, handlers]) {
          h.onStatus({ kind: 'open' });
          h.onOpen();
        }
      }, 0);
    }
    send(m: unknown) {
      deliver(this.host?.handlers, m);
    }
    destroy() {}
  }
  return {
    HostLink: MockHost,
    GuestLink: MockGuest,
    newRoomCode: () => 'sala1234',
    isValidRoomCode: (c: string) => /^[a-z0-9]{4,32}$/.test(c),
  };
});

const { App } = await import('./app');

const tick = () => new Promise((r) => setTimeout(r, 5));
const SIZE = 800;

/** Clica numa casa do tabuleiro de `root`, respeitando a orientação. */
function clickSquare(root: HTMLElement, name: string) {
  const board = root.querySelector<HTMLElement>('.board')!;
  board.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE, height: SIZE }) as DOMRect;
  const cells = [...board.querySelectorAll<HTMLElement>('.sq')];
  const idx = cells.findIndex((c) => c.dataset.square === name);
  const x = (idx % 8) * 100 + 50;
  const y = Math.floor(idx / 8) * 100 + 50;
  board.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true }));
}

const moveList = (root: HTMLElement) =>
  [...root.querySelectorAll('.moves li')].map((li) => [...li.children].map((c) => c.textContent).join(' ').trim()).join(' | ');

describe('fluxo da interface', () => {
  it('criar sala, entrar pelo link, jogar, terminar e pedir revanche', async () => {
    const hostRoot = document.createElement('div');
    const guestRoot = document.createElement('div');
    document.body.append(hostRoot, guestRoot);
    // Os dois App dividem a mesma `location`; o happy-dom dispara hashchange até em
    // replaceState, o que não acontece no navegador. Ignoramos esse evento aqui.
    const realAdd = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, l: EventListener, o?: AddEventListenerOptions) =>
      type === 'hashchange' ? undefined : realAdd(type, l, o)) as typeof window.addEventListener);

    // Anfitrião: escolhe 3 min e pretas.
    new App(hostRoot);
    hostRoot.querySelector<HTMLInputElement>('input[name=time][value="3"]')!.checked = true;
    hostRoot.querySelector<HTMLInputElement>('input[name=color][value="b"]')!.checked = true;
    hostRoot.querySelector<HTMLButtonElement>('#create')!.click();
    const link = hostRoot.querySelector<HTMLInputElement>('#share-url')!.value;
    expect(link).toMatch(/#\/j\/sala1234$/);

    // Convidado abre o link (sem disparar hashchange no anfitrião).
    history.replaceState(null, '', '#/j/sala1234');
    new App(guestRoot);
    await tick();
    await tick();

    expect(hostRoot.querySelector('.board')).not.toBeNull();
    expect(guestRoot.querySelector('.board')).not.toBeNull();
    // Pretas veem o tabuleiro invertido.
    expect(hostRoot.querySelector('.sq')!.getAttribute('data-square')).toBe('h1');
    expect(guestRoot.querySelector('.sq')!.getAttribute('data-square')).toBe('a8');
    expect(guestRoot.querySelector('.player.bottom .clock')!.textContent).toBe('3:00');
    expect(guestRoot.querySelector('.status')!.textContent).toBe('Sua vez');

    // Mate do louco: convidado (brancas) f3, g4; anfitrião (pretas) e5, Dh4#.
    clickSquare(guestRoot, 'f2');
    clickSquare(guestRoot, 'f3');
    await tick();
    clickSquare(hostRoot, 'e7');
    clickSquare(hostRoot, 'e5');
    await tick();
    clickSquare(guestRoot, 'g2');
    clickSquare(guestRoot, 'g4');
    await tick();
    expect(moveList(hostRoot)).toBe('1. f3 e5 | 2. g4');
    clickSquare(hostRoot, 'd8');
    clickSquare(hostRoot, 'h4');
    await tick();

    expect(moveList(guestRoot)).toBe('1. f3 e5 | 2. g4 Qh4#');
    expect(guestRoot.querySelector('.player.bottom .captured')!.textContent).toBe('');
    expect(guestRoot.querySelector('.overlay h2')!.textContent).toBe('Você perdeu');
    expect(hostRoot.querySelector('.overlay h2')!.textContent).toBe('Você venceu!');
    expect(hostRoot.querySelector('.overlay')!.textContent).toContain('por xeque-mate');

    // "Ver tabuleiro" fecha o resultado e ele não reabre sozinho.
    guestRoot.querySelector<HTMLButtonElement>('#view-board')!.click();
    expect(guestRoot.querySelector<HTMLElement>('.overlay')!.hidden).toBe(true);
    // Revanche pedida pelo anfitrião; o convidado reabre o resultado e aceita.
    hostRoot.querySelector<HTMLButtonElement>('#rematch')!.click();
    await tick();
    expect(guestRoot.querySelector<HTMLElement>('.overlay')!.hidden).toBe(true);
    guestRoot.querySelector<HTMLButtonElement>('#reopen')!.click();
    guestRoot.querySelector<HTMLButtonElement>('#rematch-accept')!.click();
    await tick();

    // Cores trocadas: agora o anfitrião joga de brancas.
    expect(hostRoot.querySelector('.sq')!.getAttribute('data-square')).toBe('a8');
    expect(hostRoot.querySelector('.status')!.textContent).toBe('Sua vez');
    expect(guestRoot.querySelector('#reopen')).toBeNull();
    expect(moveList(guestRoot)).toBe('');

    // Proposta de empate aceita pela interface.
    guestRoot.querySelector<HTMLButtonElement>('#draw')!.click();
    await tick();
    hostRoot.querySelector<HTMLButtonElement>('#accept-draw')!.click();
    await tick();
    expect(guestRoot.querySelector('.overlay h2')!.textContent).toBe('Empate');
    expect(guestRoot.querySelector('.overlay')!.textContent).toContain('por acordo');
  });
});
