import type { Color, Piece } from '../chess';
import type { GameResult } from '../chess/game';
import { TIME_OPTIONS_MINUTES, formatClock } from '../game/clock';
import { ABANDON_TIMEOUT_MS, Session } from '../game/session';
import { GuestLink, HostLink, type LinkStatus, isValidRoomCode, newRoomCode } from '../net/peer';
import { BoardView, pieceUrl } from './board';
import { onSettingsChange } from './settings';

const COLOR_NAME: Record<Color, string> = { w: 'Brancas', b: 'Pretas' };
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const REASON_TEXT: Record<GameResult['reason'], string> = {
  checkmate: 'por xeque-mate',
  stalemate: 'por afogamento',
  threefold: 'por tripla repetição',
  'fifty-moves': 'pela regra dos 50 lances',
  insufficient: 'por material insuficiente',
  timeout: 'por tempo',
  'timeout-insufficient': 'tempo esgotado, mas sem material para mate',
  resign: 'por desistência',
  agreement: 'por acordo',
  abandon: 'por abandono (conexão perdida)',
};

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}#/j/${code}`;
}

function guestToken(code: string): string {
  const key = `xadrez-p2p-token-${code}`;
  let token = sessionStorage.getItem(key);
  if (!token) {
    // getRandomValues funciona também fora de contexto seguro (http em IP da rede local).
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(key, token);
  }
  return token;
}

export class App {
  private session: Session | null = null;
  private link: HostLink | GuestLink | null = null;
  private board: BoardView | null = null;
  private linkStatus: LinkStatus = { kind: 'starting' };
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Partida cujo resultado o jogador fechou com "Ver tabuleiro". */
  private dismissedGame: number | null = null;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('hashchange', () => this.route());
    // Novo estilo de peças: redesenha tabuleiro, peças capturadas e promoção.
    onSettingsChange(() => {
      if (this.board) this.render();
    });
    this.route();
  }

  private route(): void {
    const m = location.hash.match(/^#\/j\/([a-z0-9]+)$/);
    if (m && isValidRoomCode(m[1])) this.join(m[1]);
    else if (!this.session || this.session.role !== 'host') this.showLobby();
  }

  private teardown(): void {
    this.link?.destroy();
    this.link = null;
    this.session = null;
    this.board = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
  }

  // -------------------------------------------------------------------------
  // Lobby

  private showLobby(): void {
    this.teardown();
    const times = TIME_OPTIONS_MINUTES.map(
      (m, i) =>
        `<label class="chip"><input type="radio" name="time" value="${m}" ${i === 1 || TIME_OPTIONS_MINUTES.length === 1 ? 'checked' : ''}><span>${m} min</span></label>`,
    ).join('');
    const view = h(`
      <main class="lobby">
        <h1>Xadrez P2P</h1>
        <p class="sub">Partida direta entre dois navegadores, sem servidor de jogo.</p>
        <section class="card">
          <h2>Criar partida</h2>
          <div class="field"><span class="label">Tempo por jogador</span><div class="chips">${times}</div></div>
          <div class="field"><span class="label">Sua cor</span><div class="chips">
            <label class="chip"><input type="radio" name="color" value="w" checked><span>Brancas</span></label>
            <label class="chip"><input type="radio" name="color" value="b"><span>Pretas</span></label>
            <label class="chip"><input type="radio" name="color" value="random"><span>Sorteio</span></label>
          </div></div>
          <button class="primary" id="create">Criar sala</button>
        </section>
        <section class="card">
          <h2>Entrar numa partida</h2>
          <form id="join" class="join-row">
            <input id="code" placeholder="Código ou link da sala" autocomplete="off" spellcheck="false">
            <button>Entrar</button>
          </form>
          <p class="error" id="join-error"></p>
        </section>
      </main>`);
    $(view, '#create').addEventListener('click', () => {
      const minutes = Number(($(view, 'input[name=time]:checked') as HTMLInputElement).value);
      const c = ($(view, 'input[name=color]:checked') as HTMLInputElement).value;
      const color: Color = c === 'random' ? (crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'w' : 'b') : (c as Color);
      this.host(minutes * 60_000, color);
    });
    $(view, '#join').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = ($(view, '#code') as HTMLInputElement).value.trim().toLowerCase();
      const code = raw.match(/#\/j\/([a-z0-9]+)/)?.[1] ?? raw;
      if (!isValidRoomCode(code)) {
        $(view, '#join-error').textContent = 'Código inválido.';
        return;
      }
      location.hash = `#/j/${code}`;
    });
    this.root.replaceChildren(view);
  }

  // -------------------------------------------------------------------------
  // Criar / entrar

  private host(timeMs: number, hostColor: Color): void {
    this.teardown();
    const code = newRoomCode();
    let link: HostLink;
    const session = Session.host(
      { send: (m) => link.send(m), now: () => performance.now(), kick: () => link.kick() },
      { timeMs, hostColor },
    );
    link = new HostLink(code, this.linkHandlers(session));
    this.start(session, link);
  }

  private join(code: string): void {
    if (this.link instanceof GuestLink && this.link.code === code) return;
    this.teardown();
    let link: GuestLink;
    const session = Session.guest({ send: (m) => link.send(m), now: () => performance.now() }, guestToken(code));
    link = new GuestLink(code, this.linkHandlers(session));
    this.start(session, link);
  }

  private linkHandlers(session: Session) {
    return {
      onStatus: (s: LinkStatus) => {
        this.linkStatus = s;
        this.render();
      },
      onOpen: () => session.peerConnected(),
      onMessage: (d: unknown) => session.receive(d),
      onClose: () => session.peerDisconnected(),
    };
  }

  private start(session: Session, link: HostLink | GuestLink): void {
    this.session = session;
    this.link = link;
    session.on((e) => {
      if (e.type === 'notice') this.showNotice(e.text);
      else this.render();
    });
    this.timer = setInterval(() => session.tick(), 100);
    const loop = () => {
      this.renderClocks();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.render();
  }

  // -------------------------------------------------------------------------
  // Render

  private render(): void {
    const s = this.session;
    if (!s) return;
    if (s.phase === 'waiting' || s.phase === 'connecting' || s.phase === 'rejected' || s.phase === 'error') {
      this.renderPreGame(s);
    } else {
      this.renderGame(s);
    }
  }

  private renderPreGame(s: Session): void {
    this.board = null;
    const st = this.linkStatus;
    let body: string;
    if (s.phase === 'rejected' || s.phase === 'error') {
      body = `<p class="error">${s.errorMessage ?? 'Erro.'}</p>`;
    } else if (st.kind === 'failed') {
      body = `<p class="error">${st.reason}</p>`;
    } else if (s.role === 'host') {
      const code = (this.link as HostLink).code;
      const ready = st.kind !== 'starting';
      body = ready
        ? `<p>Envie este link ao adversário:</p>
           <div class="share"><input readonly value="${joinUrl(code)}" id="share-url"><button id="copy">Copiar</button></div>
           <p class="muted">Código da sala: <strong class="code">${code}</strong></p>
           <p class="muted">Tempo: ${s.timeMs / 60_000} min · Você joga de ${COLOR_NAME[s.myColor]}</p>
           <p class="waiting"><span class="spinner"></span> Aguardando o adversário… Mantenha esta aba aberta.</p>`
        : `<p class="waiting"><span class="spinner"></span> Registrando a sala…</p>`;
    } else {
      body = `<p class="waiting"><span class="spinner"></span> Conectando à sala…</p>`;
    }
    const view = h(`<main class="lobby"><h1>Xadrez P2P</h1><section class="card">${body}
      <button class="link" id="back">Voltar ao início</button></section></main>`);
    view.querySelector('#copy')?.addEventListener('click', async () => {
      const input = $(view, '#share-url') as HTMLInputElement;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      $(view, '#copy').textContent = 'Copiado!';
    });
    $(view, '#back').addEventListener('click', () => this.leave());
    this.root.replaceChildren(view);
  }

  private leave(): void {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    this.showLobby();
  }

  private renderGame(s: Session): void {
    let view = this.root.querySelector<HTMLElement>('.game');
    if (!view || !this.board) {
      this.board = new BoardView((uci) => s.move(uci));
      view = h(`
        <main class="game">
          <div class="board-col">
            <div class="player top"><span class="name"></span><span class="captured"></span><span class="clock"></span></div>
            <div class="board-wrap"></div>
            <div class="player bottom"><span class="name"></span><span class="captured"></span><span class="clock"></span></div>
          </div>
          <aside class="side">
            <div class="conn"></div>
            <div class="status"></div>
            <ol class="moves"></ol>
            <div class="offer"></div>
            <div class="actions">
              <button id="draw">Propor empate</button>
              <button id="resign" class="danger">Desistir</button>
            </div>
          </aside>
          <div class="notice" hidden></div>
          <div class="overlay" hidden></div>
        </main>`);
      $(view, '.board-wrap').appendChild(this.board.el);
      $(view, '#draw').addEventListener('click', () => s.offerDraw());
      $(view, '#resign').addEventListener('click', () => {
        if (confirm('Desistir da partida?')) s.resign();
      });
      this.root.replaceChildren(view);
    }

    const g = s.game;
    const playing = s.phase === 'playing';
    this.board.update({
      position: g.position,
      orientation: s.myColor,
      lastMove: g.lastMove,
      inCheck: g.inCheck(),
      legalMoves: s.isMyTurn ? g.legalMoves() : [],
    });

    // Jogadores e material
    const captured = g.captured();
    const material = (c: Color) => captured[c === 'w' ? 'b' : 'w'].reduce((n, p) => n + PIECE_VALUE[p.type], 0);
    const fill = (el: HTMLElement, color: Color, label: string) => {
      $(el, '.name').innerHTML = `<span class="dot ${color}"></span>${label}`;
      const taken = captured[color === 'w' ? 'b' : 'w'];
      const diff = material(color) - material(color === 'w' ? 'b' : 'w');
      $(el, '.captured').innerHTML =
        sortPieces(taken).map((p) => `<img src="${pieceUrl(p)}" alt="">`).join('') + (diff > 0 ? `<span class="adv">+${diff}</span>` : '');
    };
    fill($(view, '.player.top'), s.opponentColor, `Adversário (${COLOR_NAME[s.opponentColor]})`);
    fill($(view, '.player.bottom'), s.myColor, `Você (${COLOR_NAME[s.myColor]})`);

    // Conexão
    const conn = $(view, '.conn');
    const lost = !s.connected && playing;
    conn.hidden = !lost;
    if (lost) {
      const msg =
        s.role === 'guest'
          ? 'Conexão perdida. Tentando reconectar…'
          : 'Adversário desconectado. Aguardando reconexão…';
      conn.innerHTML = `<span class="spinner"></span> ${msg} <span class="abandon"></span>`;
    }

    // Status
    let status = '';
    if (playing) status = s.isMyTurn ? 'Sua vez' : 'Vez do adversário';
    if (playing && g.inCheck()) status += ' — xeque!';
    $(view, '.status').textContent = status;

    // Lances
    const list = $(view, '.moves');
    const hist = g.history;
    const items: string[] = [];
    for (let i = 0; i < hist.length; i += 2) {
      items.push(`<li><span class="n">${i / 2 + 1}.</span><span>${hist[i].san}</span><span>${hist[i + 1]?.san ?? ''}</span></li>`);
    }
    const html = items.join('');
    if (list.innerHTML !== html) {
      list.innerHTML = html;
      list.scrollTop = list.scrollHeight;
    }

    // Propostas
    const offer = $(view, '.offer');
    offer.innerHTML = '';
    if (playing && s.drawOffer === 'received') {
      offer.append(h(`<div class="offer-box">O adversário propõe empate.
        <div class="row"><button id="accept-draw" class="primary">Aceitar</button><button id="decline-draw">Recusar</button></div></div>`));
      $(offer, '#accept-draw').addEventListener('click', () => s.acceptDraw());
      $(offer, '#decline-draw').addEventListener('click', () => s.declineDraw());
    } else if (playing && s.drawOffer === 'sent') {
      offer.append(h(`<div class="offer-box muted">Proposta de empate enviada.</div>`));
    }
    const drawBtn = $<HTMLButtonElement>(view, '#draw');
    drawBtn.disabled = !playing || s.drawOffer !== 'none' || !s.connected;
    $<HTMLButtonElement>(view, '#resign').disabled = !playing || (s.role === 'guest' && !s.connected);

    this.renderOverlay(s, $(view, '.overlay'));
    this.renderClocks();
  }

  private renderOverlay(s: Session, el: HTMLElement): void {
    const r = s.result;
    if (s.phase !== 'over' || !r) {
      el.hidden = true;
      el.innerHTML = '';
      this.root.querySelector('#reopen')?.remove();
      return;
    }
    if (this.dismissedGame === s.gameNo) {
      el.hidden = true;
      this.showReopen(s);
      return;
    }
    if (!el.hidden && el.dataset.gameNo === String(s.gameNo) && el.dataset.offer === s.rematchOffer && el.dataset.conn === String(s.connected)) return;
    el.dataset.gameNo = String(s.gameNo);
    el.dataset.offer = s.rematchOffer;
    el.dataset.conn = String(s.connected);
    const title = r.winner === null ? 'Empate' : r.winner === s.myColor ? 'Você venceu!' : 'Você perdeu';
    const score = r.winner === null ? '½–½' : r.winner === 'w' ? '1–0' : '0–1';
    let rematch = '';
    if (!s.connected) rematch = '<p class="muted">Adversário desconectado.</p>';
    else if (s.rematchOffer === 'received')
      rematch = '<p>O adversário quer revanche.</p><button id="rematch-accept" class="primary">Aceitar revanche</button>';
    else if (s.rematchOffer === 'sent') rematch = '<p class="muted">Revanche proposta. Aguardando o adversário…</p>';
    else rematch = '<button id="rematch" class="primary">Pedir revanche</button>';
    el.innerHTML = `<div class="result-card">
        <h2>${title}</h2>
        <p class="score">${score}</p>
        <p>${r.winner ? COLOR_NAME[r.winner] + ' vencem ' : ''}${REASON_TEXT[r.reason]}</p>
        ${rematch}
        <div class="row"><button id="view-board">Ver tabuleiro</button><button id="new-room">Nova sala</button></div>
      </div>`;
    el.hidden = false;
    el.querySelector('#rematch')?.addEventListener('click', () => s.offerRematch());
    el.querySelector('#rematch-accept')?.addEventListener('click', () => s.acceptRematch());
    $(el, '#view-board').addEventListener('click', () => {
      this.dismissedGame = s.gameNo;
      el.hidden = true;
      this.showReopen(s);
    });
    $(el, '#new-room').addEventListener('click', () => this.leave());
  }

  /** Depois de "Ver tabuleiro", deixa um botão para reabrir o resultado. */
  private showReopen(s: Session): void {
    const actions = this.root.querySelector('.actions');
    if (!actions || actions.querySelector('#reopen')) return;
    const b = h('<button id="reopen" class="primary">Resultado e revanche</button>');
    b.addEventListener('click', () => {
      b.remove();
      this.dismissedGame = null;
      const el = this.root.querySelector<HTMLElement>('.overlay')!;
      el.dataset.gameNo = '';
      this.renderOverlay(s, el);
    });
    actions.prepend(b);
  }

  private renderClocks(): void {
    const s = this.session;
    if (!s || !this.board) return;
    const now = performance.now();
    const set = (sel: string, color: Color) => {
      const el = this.root.querySelector<HTMLElement>(`.player.${sel} .clock`);
      if (!el) return;
      const ms = s.clock.timeLeft(color, now);
      const text = formatClock(ms);
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('running', s.clock.running === color);
      el.classList.toggle('low', ms < 20_000);
    };
    set('top', s.opponentColor);
    set('bottom', s.myColor);
    const ab = this.root.querySelector<HTMLElement>('.conn .abandon');
    if (ab && s.disconnectedSince !== null) {
      const left = Math.max(0, Math.ceil((ABANDON_TIMEOUT_MS - (now - s.disconnectedSince)) / 1000));
      ab.textContent = `(encerra em ${left} s)`;
    }
  }

  private showNotice(text: string): void {
    const el = this.root.querySelector<HTMLElement>('.notice');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (el.hidden = true), 4000);
  }
}

function sortPieces(pieces: Piece[]): Piece[] {
  const order = 'pnbrq';
  return [...pieces].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}
