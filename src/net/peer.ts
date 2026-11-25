import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Msg } from './protocol';

/**
 * Camada de conexão: PeerJS (broker público 0.peerjs.com) só para a sinalização;
 * os dados da partida vão por um RTCDataChannel direto entre os navegadores.
 */

/** Servidores STUN públicos. Sem TURN: redes com NAT simétrico podem não conectar (ver README). */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Prefixo dos IDs no broker público, para não colidir com outros apps. */
const ID_PREFIX = 'xadrez-p2p-v1-';
const HEARTBEAT_MS = 2_000;
/** Sem nenhuma mensagem do par por esse tempo, a conexão é considerada perdida. */
const SILENCE_TIMEOUT_MS = 10_000;
const RETRY_MS = 3_000;
const INITIAL_JOIN_ATTEMPTS = 4;

export type LinkStatus =
  | { kind: 'starting' }
  | { kind: 'waiting' } // anfitrião registrado no broker, sem convidado
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'reconnecting' }
  | { kind: 'failed'; reason: string };

export interface LinkHandlers {
  onStatus(status: LinkStatus): void;
  onOpen(): void;
  onMessage(data: unknown): void;
  onClose(): void;
}

const peerOptions = (): PeerOptions => ({ config: { iceServers: ICE_SERVERS }, debug: 1 });

/** Código curto da sala, sem caracteres ambíguos. */
export function newRoomCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function isValidRoomCode(code: string): boolean {
  return /^[a-z0-9]{4,32}$/.test(code);
}

abstract class Link {
  protected peer: Peer | null = null;
  protected conn: DataConnection | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  protected closed = false;

  constructor(protected readonly handlers: LinkHandlers) {}

  send(msg: Msg): void {
    if (this.conn?.open) {
      try {
        this.conn.send(msg);
      } catch (err) {
        console.warn('Falha ao enviar', err);
      }
    }
  }

  get isOpen(): boolean {
    return !!this.conn?.open;
  }

  destroy(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.conn?.close();
    this.peer?.destroy();
  }

  /** Liga os eventos de uma conexão de dados. */
  protected attach(conn: DataConnection): void {
    conn.on('open', () => {
      if (this.conn !== conn) return;
      this.lastSeen = Date.now();
      this.startHeartbeat(conn);
      this.handlers.onStatus({ kind: 'open' });
      this.handlers.onOpen();
    });
    conn.on('data', (data) => {
      if (this.conn !== conn) return;
      this.lastSeen = Date.now();
      const t = (data as { t?: string } | null)?.t;
      if (t === 'ping') this.send({ t: 'pong' });
      if (t === 'ping' || t === 'pong') return;
      this.handlers.onMessage(data);
    });
    const lost = () => this.connectionLost(conn);
    conn.on('close', lost);
    conn.on('error', lost);
    // O ICE pode falhar sem o PeerJS emitir "close"; observamos o estado diretamente.
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed' || state === 'closed') lost();
    });
  }

  protected connectionLost(conn: DataConnection): void {
    if (this.conn !== conn) return;
    this.conn = null;
    this.stopHeartbeat();
    try {
      conn.close();
    } catch {
      /* já fechada */
    }
    if (this.closed) return;
    this.handlers.onClose();
    this.afterLost();
  }

  protected abstract afterLost(): void;

  private startHeartbeat(conn: DataConnection): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > SILENCE_TIMEOUT_MS) {
        this.connectionLost(conn);
        return;
      }
      this.send({ t: 'ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  protected isAlive(): boolean {
    return !!this.conn?.open && Date.now() - this.lastSeen < SILENCE_TIMEOUT_MS;
  }

  /** Mantém o registro no broker (necessário para aceitar/refazer conexões). */
  protected watchBroker(peer: Peer): void {
    peer.on('disconnected', () => {
      if (this.closed || peer.destroyed) return;
      setTimeout(() => {
        if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect();
      }, RETRY_MS);
    });
  }
}

/** Anfitrião: registra o código da sala no broker e aceita um convidado por vez. */
export class HostLink extends Link {
  constructor(
    readonly code: string,
    handlers: LinkHandlers,
  ) {
    super(handlers);
    handlers.onStatus({ kind: 'starting' });
    const peer = new Peer(ID_PREFIX + code, peerOptions());
    this.peer = peer;
    this.watchBroker(peer);
    peer.on('open', () => {
      if (!this.conn) handlers.onStatus({ kind: 'waiting' });
    });
    peer.on('connection', (conn) => this.onIncoming(conn));
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        handlers.onStatus({ kind: 'failed', reason: 'Código de sala já em uso. Crie outra sala.' });
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        // Problema com o broker: as conexões já abertas continuam; tentamos voltar.
        console.warn('Broker indisponível', err);
      } else if (err.type === 'browser-incompatible') {
        handlers.onStatus({ kind: 'failed', reason: 'Este navegador não suporta WebRTC.' });
      } else {
        console.warn('PeerJS', err.type, err);
      }
    });
  }

  /** Derruba a conexão atual (convidado recusado pela sessão). */
  kick(): void {
    const conn = this.conn;
    if (!conn) return;
    // Dá tempo da mensagem de recusa sair antes de fechar.
    setTimeout(() => this.connectionLost(conn), 500);
  }

  private onIncoming(conn: DataConnection): void {
    if (this.isAlive()) {
      // Já há um convidado ativo: recusa o novo.
      conn.on('open', () => {
        conn.send({ t: 'full' } satisfies Msg);
        setTimeout(() => conn.close(), 500);
      });
      return;
    }
    const old = this.conn;
    this.conn = conn;
    if (old) {
      try {
        old.close();
      } catch {
        /* ignorado */
      }
    }
    this.handlers.onStatus({ kind: 'connecting' });
    this.attach(conn);
  }

  protected afterLost(): void {
    this.handlers.onStatus({ kind: 'waiting' });
  }
}

/** Convidado: conecta ao código da sala e tenta reconectar sozinho se cair. */
export class GuestLink extends Link {
  private everOpened = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    handlers: LinkHandlers,
  ) {
    super(handlers);
    handlers.onStatus({ kind: 'starting' });
    const peer = new Peer(peerOptions());
    this.peer = peer;
    this.watchBroker(peer);
    peer.on('open', () => this.dial());
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        // O anfitrião não está no broker (ainda não abriu, fechou a aba ou caiu).
        this.scheduleRetry();
      } else if (err.type === 'browser-incompatible') {
        handlers.onStatus({ kind: 'failed', reason: 'Este navegador não suporta WebRTC.' });
      } else {
        console.warn('PeerJS', err.type, err);
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          this.scheduleRetry();
        }
      }
    });
    handlers.onStatus({ kind: 'connecting' });
  }

  override destroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    super.destroy();
  }

  private dial(): void {
    if (this.closed || !this.peer || this.peer.destroyed) return;
    if (this.peer.disconnected) {
      this.scheduleRetry();
      return;
    }
    this.attempts++;
    const conn = this.peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
    if (!conn) {
      this.scheduleRetry();
      return;
    }
    this.conn = conn;
    this.attach(conn);
    conn.on('open', () => {
      this.everOpened = true;
      this.attempts = 0;
    });
    // Se o canal não abrir em tempo razoável, tenta de novo.
    setTimeout(() => {
      if (this.conn === conn && !conn.open) this.connectionLost(conn);
    }, 15_000);
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer) return;
    if (!this.everOpened && this.attempts >= INITIAL_JOIN_ATTEMPTS) {
      this.handlers.onStatus({
        kind: 'failed',
        reason: 'Não foi possível conectar à sala. Confira o código ou se o anfitrião está com a página aberta.',
      });
      return;
    }
    this.handlers.onStatus({ kind: this.everOpened ? 'reconnecting' : 'connecting' });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dial();
    }, RETRY_MS);
  }

  protected afterLost(): void {
    this.scheduleRetry();
  }
}
