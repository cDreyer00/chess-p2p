/**
 * Teste de ponta a ponta da camada de rede real: broker público do PeerJS + WebRTC
 * (node-datachannel faz o papel do navegador). Precisa de internet.
 * Rode com `npm run test:p2p`.
 */
import * as polyfill from 'node-datachannel/polyfill';
import { afterAll, describe, expect, it } from 'vitest';

Object.assign(globalThis, polyfill);
// O PeerJS consulta `window`/`navigator` para detectar o navegador.
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.navigator ??= { userAgent: 'node', platform: 'node' };

const { Session } = await import('../src/game/session');
const { HostLink, GuestLink, newRoomCode } = await import('../src/net/peer');
type SessionT = import('../src/game/session').Session;
type Link = InstanceType<typeof HostLink> | InstanceType<typeof GuestLink>;

const links: Link[] = [];
afterAll(() => links.forEach((l) => l.destroy()));

function waitFor(cond: () => boolean, what: string, ms = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error(`timeout esperando: ${what}`));
      }
    }, 50);
  });
}

function wire(session: SessionT, make: (h: ConstructorParameters<typeof HostLink>[1]) => Link): Link {
  const statuses: string[] = [];
  const link = make({
    onStatus: (s) => statuses.push(s.kind),
    onOpen: () => session.peerConnected(),
    onMessage: (d) => session.receive(d),
    onClose: () => session.peerDisconnected(),
  });
  links.push(link);
  return link;
}

describe('P2P real (PeerJS + WebRTC)', () => {
  const code = newRoomCode();
  const now = () => performance.now();
  let hostLink!: InstanceType<typeof HostLink>;
  let guestLink!: InstanceType<typeof GuestLink>;

  const host: SessionT = Session.host(
    { now, send: (m) => hostLink.send(m), kick: () => hostLink.kick() },
    { timeMs: 3 * 60_000, hostColor: 'b' },
  );
  let guest: SessionT = Session.guest({ now, send: (m) => guestLink.send(m) }, 'token-e2e');

  it('conecta e começa a partida', async () => {
    hostLink = wire(host, (h) => new HostLink(code, h)) as InstanceType<typeof HostLink>;
    await new Promise((r) => setTimeout(r, 1500)); // anfitrião registra no broker
    guestLink = wire(guest, (h) => new GuestLink(code, h)) as InstanceType<typeof GuestLink>;
    await waitFor(() => guest.phase === 'playing' && host.phase === 'playing', 'início da partida');
    expect(host.myColor).toBe('b');
    expect(guest.myColor).toBe('w');
    expect(guest.timeMs).toBe(3 * 60_000);
  }, 40_000);

  it('troca lances e relógios', async () => {
    expect(guest.move('f2f3')).toBe(true);
    await waitFor(() => host.game.history.length === 1, 'lance 1 no anfitrião');
    expect(host.move('e7e5')).toBe(true);
    await waitFor(() => guest.game.history.length === 2, 'lance 2 no convidado');
    expect(guest.clock.running).toBe('w');
    expect(Math.abs(guest.clock.timeLeft('b', now()) - host.clock.timeLeft('b', now()))).toBeLessThan(500);
  });

  it('reconecta o convidado com o mesmo token', async () => {
    guestLink.destroy();
    await waitFor(() => !host.connected, 'anfitrião notar a queda', 20_000);
    expect(host.move('d8h4')).toBe(false); // não é a vez dele
    guest = Session.guest({ now, send: (m) => guestLink.send(m) }, 'token-e2e');
    guestLink = wire(guest, (h) => new GuestLink(code, h)) as InstanceType<typeof GuestLink>;
    await waitFor(() => guest.phase === 'playing' && host.connected, 'reconexão');
    expect(guest.game.history.map((m) => m.san)).toEqual(['f3', 'e5']);
  }, 40_000);

  it('mate e revanche com cores trocadas', async () => {
    expect(guest.move('g2g4')).toBe(true);
    await waitFor(() => host.game.history.length === 3, 'lance 3');
    expect(host.move('d8h4')).toBe(true);
    await waitFor(() => guest.phase === 'over', 'fim no convidado');
    expect(guest.result).toEqual({ winner: 'b', reason: 'checkmate' });
    expect(guest.game.history.at(-1)!.san).toBe('Qh4#');

    guest.offerRematch();
    await waitFor(() => host.rematchOffer === 'received', 'pedido de revanche');
    host.acceptRematch();
    await waitFor(() => guest.gameNo === 2 && guest.phase === 'playing', 'revanche');
    expect(host.myColor).toBe('w');
    expect(guest.myColor).toBe('b');
  });

  it('empate por acordo', async () => {
    host.offerDraw();
    await waitFor(() => guest.drawOffer === 'received', 'proposta de empate');
    guest.acceptDraw();
    await waitFor(() => host.phase === 'over' && guest.phase === 'over', 'empate');
    expect(guest.result).toEqual({ winner: null, reason: 'agreement' });
  });

  it('terceiro jogador é recusado', async () => {
    const intruder: SessionT = Session.guest({ now, send: (m) => intruderLink.send(m) }, 'outro-token');
    const intruderLink = wire(intruder, (h) => new GuestLink(code, h));
    await waitFor(() => intruder.phase === 'rejected', 'recusa do intruso');
    expect(guest.connected).toBe(true);
  }, 40_000);
});
