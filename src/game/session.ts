import { Game, type GameResult, type PlayedMove } from '../chess/game';
import { type Color, opposite } from '../chess/types';
import { PROTOCOL_VERSION, type Msg, type OfferState, type StateMsg, parseMsg } from '../net/protocol';
import { ChessClock, clampTimeMs } from './clock';

/**
 * Sessão de partida entre dois pares. Não conhece DOM nem PeerJS: recebe uma função
 * `send` e um relógio `now`, e é alimentada pelos eventos da conexão.
 *
 * Autoridade: o anfitrião (quem criou a sala) é a fonte oficial do relógio e dos fins
 * de partida que não saem do tabuleiro (tempo, desistência, acordo, abandono). Os lances
 * são validados pelos dois lados; um lance ilegal recebido nunca é aplicado.
 */

export type Role = 'host' | 'guest';
export type Phase = 'waiting' | 'connecting' | 'playing' | 'over' | 'rejected' | 'error';

/** Tempo sem o adversário conectado até a partida ser encerrada por abandono. */
export const ABANDON_TIMEOUT_MS = 60_000;

export interface SessionDeps {
  send(msg: Msg): void;
  now(): number;
  /** Anfitrião: derruba a conexão atual (usado para recusar um terceiro jogador). */
  kick?(): void;
}

export interface HostConfig {
  timeMs: number;
  hostColor: Color;
}

export type SessionEvent =
  | { type: 'change' }
  | { type: 'notice'; text: string }
  | { type: 'move'; played: PlayedMove; mine: boolean };

export class Session {
  readonly role: Role;
  game = new Game();
  clock: ChessClock;
  timeMs: number;
  hostColor: Color;
  gameNo = 0;
  phase: Phase;
  /** O adversário está conectado (para o anfitrião: convidado autenticado pelo token). */
  connected = false;
  disconnectedSince: number | null = null;
  drawOfferBy: Color | null = null;
  rematchOfferBy: Color | null = null;
  errorMessage: string | null = null;

  private guestToken: string | null = null;
  private readonly listeners = new Set<(e: SessionEvent) => void>();

  private constructor(
    role: Role,
    private readonly deps: SessionDeps,
    config: HostConfig,
    private readonly token: string | null,
  ) {
    this.role = role;
    this.timeMs = clampTimeMs(config.timeMs);
    this.hostColor = config.hostColor;
    this.clock = new ChessClock(this.timeMs);
    this.phase = role === 'host' ? 'waiting' : 'connecting';
  }

  static host(deps: SessionDeps, config: HostConfig): Session {
    return new Session('host', deps, config, null);
  }

  static guest(deps: SessionDeps, token: string): Session {
    // Tempo e cor reais chegam na primeira mensagem `state` do anfitrião.
    return new Session('guest', deps, { timeMs: clampTimeMs(Infinity), hostColor: 'w' }, token);
  }

  get myColor(): Color {
    return this.role === 'host' ? this.hostColor : opposite(this.hostColor);
  }

  get opponentColor(): Color {
    return opposite(this.myColor);
  }

  get result(): GameResult | null {
    return this.game.result;
  }

  get isMyTurn(): boolean {
    return this.phase === 'playing' && this.game.turn === this.myColor;
  }

  get drawOffer(): OfferState {
    return offerState(this.drawOfferBy, this.myColor);
  }

  get rematchOffer(): OfferState {
    return offerState(this.rematchOfferBy, this.myColor);
  }

  on(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Eventos da conexão

  peerConnected(): void {
    if (this.role === 'guest') {
      // O anfitrião responde com o estado completo; até lá a sessão espera.
      this.deps.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.token! });
    }
    // O anfitrião só considera o convidado conectado depois de um `hello` válido.
  }

  peerDisconnected(): void {
    if (!this.connected) return;
    this.connected = false;
    this.disconnectedSince = this.deps.now();
    if (this.phase === 'playing') this.notice('Adversário desconectado. Aguardando reconexão…');
    this.changed();
  }

  receive(raw: unknown): void {
    const msg = parseMsg(raw);
    if (!msg) return;
    if (this.role === 'host') this.receiveAsHost(msg);
    else this.receiveAsGuest(msg);
  }

  /** Chamado periodicamente pela UI: queda de bandeira e abandono. */
  tick(): void {
    if (this.phase !== 'playing') return;
    const now = this.deps.now();
    const absent = !this.connected && this.disconnectedSince !== null && now - this.disconnectedSince >= ABANDON_TIMEOUT_MS;
    if (this.role === 'host') {
      const flagged = this.clock.flagged(now);
      if (flagged) this.endByHost(this.game.timeoutResult(flagged));
      else if (absent) this.endByHost({ winner: this.hostColor, reason: 'abandon' });
    } else if (absent) {
      // Sem o anfitrião não há como continuar: encerra localmente.
      this.finishLocal({ winner: this.myColor, reason: 'abandon' });
      this.notice('A conexão com o anfitrião não voltou. Partida encerrada.');
    }
  }

  // -------------------------------------------------------------------------
  // Ações do jogador local

  /** Tenta jogar o lance (UCI). Devolve true se foi aceito localmente. */
  move(uci: string): boolean {
    if (!this.isMyTurn) return false;
    const ply = this.game.history.length;
    const played = this.game.playUci(uci);
    if (!played) return false;
    this.afterMove(this.myColor);
    this.deps.send({ t: 'move', gameNo: this.gameNo, ply, uci: played.uci });
    if (this.role === 'host') this.sendClock();
    this.emit({ type: 'move', played, mine: true });
    this.changed();
    return true;
  }

  resign(): void {
    if (this.phase !== 'playing') return;
    if (this.role === 'host') this.endByHost({ winner: this.opponentColor, reason: 'resign' });
    else this.deps.send({ t: 'resign', gameNo: this.gameNo });
  }

  offerDraw(): void {
    if (this.phase !== 'playing' || this.drawOfferBy !== null) return;
    this.drawOfferBy = this.myColor;
    this.deps.send({ t: 'draw-offer', gameNo: this.gameNo });
    this.changed();
  }

  acceptDraw(): void {
    if (this.phase !== 'playing' || this.drawOfferBy !== this.opponentColor) return;
    if (this.role === 'host') this.endByHost({ winner: null, reason: 'agreement' });
    else this.deps.send({ t: 'draw-accept', gameNo: this.gameNo });
  }

  declineDraw(): void {
    if (this.drawOfferBy !== this.opponentColor) return;
    this.drawOfferBy = null;
    this.deps.send({ t: 'draw-decline', gameNo: this.gameNo });
    this.changed();
  }

  offerRematch(): void {
    if (this.phase !== 'over' || this.rematchOfferBy !== null) return;
    this.rematchOfferBy = this.myColor;
    this.deps.send({ t: 'rematch-offer', gameNo: this.gameNo });
    this.changed();
  }

  acceptRematch(): void {
    if (this.phase !== 'over' || this.rematchOfferBy !== this.opponentColor) return;
    if (this.role === 'host') this.startNewGame(true);
    else this.deps.send({ t: 'rematch-accept', gameNo: this.gameNo });
  }

  // -------------------------------------------------------------------------
  // Anfitrião

  private receiveAsHost(msg: Msg): void {
    if (msg.t === 'hello') return this.onHello(msg.v, msg.token);
    if (!this.connected) return; // ignora quem não se identificou

    const current = 'gameNo' in msg && msg.gameNo === this.gameNo;
    switch (msg.t) {
      case 'move': {
        const guest = this.opponentColor;
        const ok =
          current && this.phase === 'playing' && this.game.turn === guest && msg.ply === this.game.history.length;
        const played = ok ? this.game.playUci(msg.uci) : null;
        if (!played) {
          // Lance fora de hora ou ilegal: rejeita e ressincroniza o convidado.
          this.sendState();
          return;
        }
        this.afterMove(guest);
        this.sendClock();
        this.emit({ type: 'move', played, mine: false });
        this.changed();
        return;
      }
      case 'resign':
        if (current && this.phase === 'playing') this.endByHost({ winner: this.hostColor, reason: 'resign' });
        return;
      case 'draw-offer':
        if (!current || this.phase !== 'playing') return;
        if (this.drawOfferBy === this.hostColor) return this.endByHost({ winner: null, reason: 'agreement' });
        this.drawOfferBy = this.opponentColor;
        this.notice('O adversário propõe empate.');
        this.changed();
        return;
      case 'draw-accept':
        if (current && this.phase === 'playing' && this.drawOfferBy === this.hostColor) {
          this.endByHost({ winner: null, reason: 'agreement' });
        }
        return;
      case 'draw-decline':
        this.onDrawDeclined(current);
        return;
      case 'rematch-offer':
        if (!current || this.phase !== 'over') return;
        if (this.rematchOfferBy === this.hostColor) return this.startNewGame(true);
        this.rematchOfferBy = this.opponentColor;
        this.notice('O adversário pede revanche.');
        this.changed();
        return;
      case 'rematch-accept':
        if (current && this.phase === 'over' && this.rematchOfferBy === this.hostColor) this.startNewGame(true);
        return;
      case 'sync-request':
        this.sendState();
        return;
      default:
        return;
    }
  }

  private onHello(version: number, token: string): void {
    if (version !== PROTOCOL_VERSION || (this.guestToken !== null && token !== this.guestToken) || this.connected) {
      // Outro jogador (ou versão incompatível): a sala é de dois.
      if (this.connected && token === this.guestToken) {
        this.sendState();
        return;
      }
      this.deps.send({ t: 'full' });
      this.deps.kick?.();
      return;
    }
    const reconnect = this.guestToken !== null;
    this.guestToken = token;
    this.connected = true;
    this.disconnectedSince = null;
    if (reconnect) {
      if (this.phase === 'playing') this.notice('Adversário reconectado.');
      this.sendState();
      this.changed();
    } else {
      this.startNewGame(false);
    }
  }

  private startNewGame(swapColors: boolean): void {
    if (swapColors) this.hostColor = opposite(this.hostColor);
    this.gameNo++;
    this.game = new Game();
    this.clock = new ChessClock(this.timeMs);
    this.clock.switchTo('w', this.deps.now());
    this.drawOfferBy = null;
    this.rematchOfferBy = null;
    this.phase = 'playing';
    this.sendState();
    this.changed();
  }

  private endByHost(result: GameResult): void {
    this.finishLocal(result);
    this.deps.send({ t: 'end', gameNo: this.gameNo, result });
  }

  private sendClock(): void {
    const now = this.deps.now();
    this.deps.send({
      t: 'clock',
      gameNo: this.gameNo,
      ply: this.game.history.length - 1,
      w: this.clock.timeLeft('w', now),
      b: this.clock.timeLeft('b', now),
      running: this.clock.running,
    });
  }

  private sendState(): void {
    const now = this.deps.now();
    const state: StateMsg = {
      t: 'state',
      gameNo: this.gameNo,
      timeMs: this.timeMs,
      hostColor: this.hostColor,
      moves: this.game.history.map((h) => h.uci),
      clock: { w: this.clock.timeLeft('w', now), b: this.clock.timeLeft('b', now), running: this.clock.running },
      result: this.game.result,
      drawOfferBy: this.drawOfferBy,
      rematchOfferBy: this.rematchOfferBy,
    };
    this.deps.send(state);
  }

  // -------------------------------------------------------------------------
  // Convidado

  private receiveAsGuest(msg: Msg): void {
    const current = 'gameNo' in msg && msg.gameNo === this.gameNo;
    switch (msg.t) {
      case 'full':
        this.phase = 'rejected';
        this.errorMessage = 'Esta sala já tem dois jogadores.';
        this.changed();
        return;
      case 'state':
        this.applyState(msg);
        return;
      case 'move': {
        const host = this.hostColor;
        const ok = current && this.phase === 'playing' && this.game.turn === host && msg.ply === this.game.history.length;
        const played = ok ? this.game.playUci(msg.uci) : null;
        if (!played) {
          // Não aplica o lance; pede o estado oficial para tirar a dúvida.
          if (current) this.deps.send({ t: 'sync-request' });
          return;
        }
        this.afterMove(host);
        this.emit({ type: 'move', played, mine: false });
        this.changed();
        return;
      }
      case 'clock':
        if (current && msg.ply === this.game.history.length - 1) {
          this.clock.set(msg.w, msg.b, this.phase === 'playing' ? msg.running : null, this.deps.now());
          this.changed();
        }
        return;
      case 'end':
        if (current && this.phase === 'playing') this.finishLocal(msg.result);
        return;
      case 'draw-offer':
        if (!current || this.phase !== 'playing') return;
        this.drawOfferBy = this.opponentColor;
        this.notice('O adversário propõe empate.');
        this.changed();
        return;
      case 'draw-decline':
        this.onDrawDeclined(current);
        return;
      case 'rematch-offer':
        if (!current || this.phase !== 'over') return;
        this.rematchOfferBy = this.opponentColor;
        this.notice('O adversário pede revanche.');
        this.changed();
        return;
      default:
        return;
    }
  }

  private applyState(s: StateMsg): void {
    const game = new Game();
    for (const uci of s.moves) {
      if (!game.playUci(uci)) {
        this.phase = 'error';
        this.errorMessage = 'O anfitrião enviou uma partida com lance ilegal. Partida encerrada.';
        this.changed();
        return;
      }
    }
    if (s.result && !game.isOver) game.finish(s.result);
    const isNewGame = s.gameNo !== this.gameNo;
    const wasDisconnected = this.phase !== 'connecting' && !this.connected;
    this.game = game;
    this.gameNo = s.gameNo;
    this.timeMs = clampTimeMs(s.timeMs);
    this.hostColor = s.hostColor;
    this.clock = new ChessClock(this.timeMs);
    this.clock.set(s.clock.w, s.clock.b, game.isOver ? null : s.clock.running, this.deps.now());
    this.drawOfferBy = s.drawOfferBy;
    this.rematchOfferBy = s.rematchOfferBy;
    this.phase = game.isOver ? 'over' : 'playing';
    this.connected = true;
    this.disconnectedSince = null;
    this.errorMessage = null;
    if (wasDisconnected && !isNewGame) this.notice('Reconectado.');
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Comum

  private afterMove(mover: Color): void {
    const now = this.deps.now();
    // Um lance do jogador que recebeu a proposta de empate equivale a recusá-la.
    if (this.drawOfferBy === opposite(mover)) this.drawOfferBy = null;
    if (this.game.isOver) {
      this.clock.stop(now);
      this.phase = 'over';
    } else {
      this.clock.switchTo(this.game.turn, now);
    }
  }

  private onDrawDeclined(current: boolean): void {
    if (current && this.drawOfferBy === this.myColor) {
      this.drawOfferBy = null;
      this.notice('O adversário recusou o empate.');
      this.changed();
    }
  }

  private finishLocal(result: GameResult): void {
    this.game.finish(result);
    this.clock.stop(this.deps.now());
    this.phase = 'over';
    this.drawOfferBy = null;
    this.changed();
  }

  private notice(text: string): void {
    this.emit({ type: 'notice', text });
  }

  private changed(): void {
    this.emit({ type: 'change' });
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function offerState(by: Color | null, me: Color): OfferState {
  if (by === null) return 'none';
  return by === me ? 'sent' : 'received';
}
