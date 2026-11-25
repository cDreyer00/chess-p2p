import { beforeEach, describe, expect, it } from 'vitest';
import type { Msg } from '../net/protocol';
import { ABANDON_TIMEOUT_MS, Session } from './session';
import { ChessClock, MAX_TIME_MINUTES, TIME_OPTIONS_MINUTES, clampTimeMs, formatClock } from './clock';

/**
 * Simula dois navegadores ligados por um canal confiável e ordenado (como o DataChannel),
 * com relógio controlado e entrega manual das mensagens.
 */
class Net {
  now = 0;
  up = true;
  toHost: Msg[] = [];
  toGuest: Msg[] = [];
  host: Session;
  guest: Session;

  constructor(timeMs = 5 * 60_000, hostColor: 'w' | 'b' = 'w', token = 'tok-1') {
    const now = () => this.now;
    this.host = Session.host(
      { now, send: (m) => this.up && this.toGuest.push(clone(m)), kick: () => (this.up = false) },
      { timeMs, hostColor },
    );
    this.guest = Session.guest({ now, send: (m) => this.up && this.toHost.push(clone(m)) }, token);
  }

  connect() {
    this.up = true;
    this.host.peerConnected();
    this.guest.peerConnected();
    this.flush();
  }

  drop() {
    this.up = false;
    this.toHost = [];
    this.toGuest = [];
    this.host.peerDisconnected();
    this.guest.peerDisconnected();
  }

  /** Entrega todas as mensagens pendentes, nas duas direções, até esvaziar. */
  flush() {
    while (this.toHost.length || this.toGuest.length) {
      const h = this.toHost.shift();
      if (h) this.host.receive(h);
      const g = this.toGuest.shift();
      if (g) this.guest.receive(g);
    }
  }

  advance(ms: number) {
    this.now += ms;
    this.host.tick();
    this.guest.tick();
    this.flush();
  }

  /** Joga uma lista de lances alternando quem estiver na vez. */
  play(ucis: string) {
    for (const uci of ucis.split(' ')) {
      const s = this.host.isMyTurn ? this.host : this.guest;
      expect(s.move(uci), `lance ${uci}`).toBe(true);
      this.flush();
    }
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('relógio', () => {
  it('limite máximo de 15 minutos e opções', () => {
    expect(MAX_TIME_MINUTES).toBe(15);
    expect(TIME_OPTIONS_MINUTES).toEqual([3, 5, 10, 15]);
    expect(clampTimeMs(60 * 60_000)).toBe(15 * 60_000);
    expect(clampTimeMs(3 * 60_000)).toBe(3 * 60_000);
  });

  it('desconta só de quem está na vez', () => {
    const c = new ChessClock(60_000);
    c.switchTo('w', 0);
    expect(c.timeLeft('w', 10_000)).toBe(50_000);
    c.switchTo('b', 10_000);
    expect(c.timeLeft('w', 30_000)).toBe(50_000);
    expect(c.timeLeft('b', 30_000)).toBe(40_000);
    expect(c.flagged(70_000)).toBe('b');
  });

  it('formatação', () => {
    expect(formatClock(5 * 60_000)).toBe('5:00');
    expect(formatClock(61_001)).toBe('1:02');
    expect(formatClock(9_450)).toBe('0:09.4');
  });
});

describe('sessão P2P', () => {
  let net: Net;
  beforeEach(() => {
    net = new Net();
    net.connect();
  });

  it('o convidado recebe o estado e as cores ficam opostas', () => {
    expect(net.host.phase).toBe('playing');
    expect(net.guest.phase).toBe('playing');
    expect(net.host.myColor).toBe('w');
    expect(net.guest.myColor).toBe('b');
    expect(net.guest.timeMs).toBe(5 * 60_000);
  });

  it('lances chegam aos dois lados e cada um só joga na sua vez', () => {
    expect(net.guest.move('e7e5')).toBe(false);
    net.play('e2e4 e7e5 g1f3');
    expect(net.guest.game.history.map((h) => h.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(net.host.game.history.map((h) => h.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('o anfitrião rejeita lance ilegal e ressincroniza o convidado', () => {
    net.play('e2e4');
    net.toHost.push({ t: 'move', gameNo: 1, ply: 1, uci: 'e8e6' });
    net.flush();
    expect(net.host.game.history).toHaveLength(1);
    expect(net.guest.game.history).toHaveLength(1);
    // Lance com ply errado também é recusado.
    net.toHost.push({ t: 'move', gameNo: 1, ply: 5, uci: 'e7e5' });
    net.flush();
    expect(net.host.game.history).toHaveLength(1);
  });

  it('o convidado não aplica lance ilegal do anfitrião', () => {
    net.toGuest.push({ t: 'move', gameNo: 1, ply: 0, uci: 'e2e5' });
    net.flush();
    expect(net.guest.game.history).toHaveLength(0);
  });

  it('mensagens malformadas são ignoradas', () => {
    net.guest.receive({ t: 'move', gameNo: 1, ply: 0, uci: 'xx' });
    net.host.receive('lixo');
    net.host.receive({ t: 'end', gameNo: 1, result: { winner: 'w', reason: 'hack' } });
    expect(net.host.phase).toBe('playing');
  });

  it('relógio: o anfitrião é a autoridade e o convidado se ajusta', () => {
    net.advance(10_000);
    net.play('e2e4');
    expect(net.host.clock.timeLeft('w', net.now)).toBe(290_000);
    net.advance(20_000);
    net.play('e7e5');
    expect(net.guest.clock.timeLeft('b', net.now)).toBe(280_000);
    expect(net.guest.clock.timeLeft('w', net.now)).toBe(290_000);
    expect(net.guest.clock.running).toBe('w');
  });

  it('queda de bandeira: o anfitrião decide e avisa', () => {
    net.play('e2e4');
    net.advance(5 * 60_000);
    expect(net.host.result).toEqual({ winner: 'w', reason: 'timeout' });
    expect(net.guest.result).toEqual({ winner: 'w', reason: 'timeout' });
    expect(net.guest.phase).toBe('over');
  });

  it('mate encerra nos dois lados', () => {
    net.play('f2f3 e7e5 g2g4 d8h4');
    expect(net.host.result).toEqual({ winner: 'b', reason: 'checkmate' });
    expect(net.guest.result).toEqual({ winner: 'b', reason: 'checkmate' });
  });

  it('desistência do convidado', () => {
    net.guest.resign();
    net.flush();
    expect(net.host.result).toEqual({ winner: 'w', reason: 'resign' });
    expect(net.guest.result).toEqual({ winner: 'w', reason: 'resign' });
  });

  it('empate por acordo e recusa', () => {
    net.guest.offerDraw();
    net.flush();
    expect(net.host.drawOffer).toBe('received');
    net.host.declineDraw();
    net.flush();
    expect(net.guest.drawOffer).toBe('none');

    net.host.offerDraw();
    net.flush();
    expect(net.guest.drawOffer).toBe('received');
    net.guest.acceptDraw();
    net.flush();
    expect(net.host.result).toEqual({ winner: null, reason: 'agreement' });
    expect(net.guest.result).toEqual({ winner: null, reason: 'agreement' });
  });

  it('jogar um lance recusa a proposta de empate recebida', () => {
    net.guest.offerDraw();
    net.flush();
    net.play('e2e4');
    expect(net.host.drawOffer).toBe('none');
    expect(net.guest.drawOffer).toBe('none');
  });

  it('revanche troca as cores e zera o relógio', () => {
    net.host.resign();
    net.flush();
    net.guest.offerRematch();
    net.flush();
    expect(net.host.rematchOffer).toBe('received');
    net.host.acceptRematch();
    net.flush();
    expect(net.host.gameNo).toBe(2);
    expect(net.guest.gameNo).toBe(2);
    expect(net.host.myColor).toBe('b');
    expect(net.guest.myColor).toBe('w');
    expect(net.guest.phase).toBe('playing');
    expect(net.guest.move('e2e4')).toBe(true);
    net.flush();
    expect(net.host.game.history).toHaveLength(1);
  });

  it('reconexão do convidado recupera a partida (inclusive lance feito durante a queda)', () => {
    net.play('e2e4 e7e5');
    net.drop();
    expect(net.host.connected).toBe(false);
    net.host.move('g1f3'); // perdido na rede
    net.advance(5_000);
    net.connect();
    expect(net.guest.game.history.map((h) => h.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(net.guest.phase).toBe('playing');
    expect(net.guest.isMyTurn).toBe(true);
  });

  it('convidado que recarrega a página com o mesmo token volta à partida', () => {
    net.play('e2e4');
    net.drop();
    const reloaded = Session.guest({ now: () => net.now, send: (m) => net.toHost.push(clone(m)) }, 'tok-1');
    net.guest = reloaded;
    net.connect();
    expect(reloaded.game.history).toHaveLength(1);
    expect(reloaded.myColor).toBe('b');
  });

  it('terceiro jogador é recusado', () => {
    net.drop();
    const intruder = Session.guest({ now: () => net.now, send: (m) => net.toHost.push(clone(m)) }, 'outro');
    net.guest = intruder;
    net.up = true;
    intruder.peerConnected();
    net.flush();
    expect(intruder.phase).toBe('rejected');
  });

  it('abandono: sem reconexão por 60 s a partida termina', () => {
    net.drop();
    net.advance(ABANDON_TIMEOUT_MS - 1);
    expect(net.host.phase).toBe('playing');
    net.advance(1);
    expect(net.host.result).toEqual({ winner: 'w', reason: 'abandon' });
    expect(net.guest.result?.reason).toBe('abandon');
  });
});
