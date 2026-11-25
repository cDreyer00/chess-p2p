# Xadrez P2P

Xadrez no navegador para dois jogadores, conectados direto um ao outro por WebRTC.
Não há servidor de jogo: um jogador cria a sala, manda o link e a partida acontece entre os dois navegadores.

## Como rodar

Requisitos: Node.js 20 ou mais recente.

```bash
npm install
npm run dev        # servidor de desenvolvimento em http://localhost:5173
npm run build      # checa tipos e gera dist/ (site estático)
npm run preview    # serve o dist/ gerado
npm test           # testes de regras, sessão, tabuleiro e interface
npm run test:p2p   # teste de rede real (broker PeerJS + WebRTC), precisa de internet
```

O `dist/` é estático e usa caminhos relativos: pode ser publicado em qualquer hospedagem de arquivos (GitHub Pages, Netlify, um bucket).

## Como testar o multiplayer localmente

1. Rode `npm run dev`.
2. Abra `http://localhost:5173` numa janela.
3. Escolha o tempo e a cor e clique em **Criar sala**.
4. Clique em **Copiar** e abra o link numa segunda janela ou aba (pode ser janela anônima ou outro navegador).
5. A partida começa sozinha. Quem joga de pretas vê o tabuleiro invertido.

Dicas:

- Use duas **janelas** lado a lado em vez de abas: abas em segundo plano têm timers mais lentos, e o relógio da aba escondida só atualiza na tela quando ela volta.
- Para testar no celular na mesma rede, abra o anfitrião pelo IP que o Vite mostra (`http://192.168.x.x:5173`), não por `localhost`: o link gerado usa o endereço da página.
- Para testar a reconexão, recarregue a aba do convidado: ela volta para a mesma partida. Feche a aba para testar o abandono (60 s).

## Regras implementadas

- Lances legais de todas as peças, xeque, xeque-mate e afogamento.
- Roque pequeno e grande (sem rocar em xeque, atravessando casa atacada ou depois de mover rei/torre).
- En passant (só no lance seguinte e sem expor o próprio rei).
- Promoção com escolha de dama, torre, bispo ou cavalo.
- Empates automáticos: tripla repetição (com en passant contando só se a captura for legal), regra dos 50 lances e material insuficiente (K×K, K+menor×K, bispos todos na mesma cor de casa).
- Relógio sem incremento, com opções de 3, 5, 10 e 15 minutos por jogador. Quem zera perde; empata se o adversário só tiver rei, rei + bispo ou rei + cavalo.
- Desistir, propor/aceitar/recusar empate (jogar um lance recusa a proposta) e pedir revanche (as cores trocam).

O limite de tempo fica em `MAX_TIME_MINUTES`, em `src/game/clock.ts`. As opções acima desse limite somem sozinhas.

## Arquitetura

```
src/chess/   regras puras (sem DOM): posição, FEN, gerador de lances, SAN, fim de partida
src/game/    relógio e sessão da partida (protocolo e autoridade), sem DOM nem PeerJS
src/net/     mensagens do protocolo (com validação) e conexão PeerJS/WebRTC
src/ui/      tabuleiro (clicar e arrastar) e telas
e2e/         teste de rede real
```

- O gerador de lances é validado por **perft** em 6 posições conhecidas (inicial, Kiwipete e as posições 3 a 6 do Chess Programming Wiki), até 197.281 nós.
- O lance trafega em UCI (`e2e4`, `e7e8q`). Os dois lados validam cada lance recebido com o próprio motor; um lance ilegal nunca é aplicado.
- O **anfitrião** (quem criou a sala) é a autoridade do relógio e dos fins que não saem do tabuleiro (tempo, desistência, acordo, abandono). Depois de cada lance ele envia os tempos oficiais, e o convidado ajusta o próprio relógio. Se o convidado mandar um lance fora de hora ou ilegal, o anfitrião responde com o estado completo da partida.
- Mate, afogamento e empates automáticos são calculados nos dois lados pelas mesmas regras.

### Desconexão

- A conexão manda um batimento a cada 2 s. Sem nenhuma mensagem por 10 s, a conexão é dada como perdida (o WebRTC nem sempre avisa quando cai).
- Os dois lados mostram um aviso com contagem regressiva. O relógio continua correndo.
- O convidado tenta reconectar sozinho a cada 3 s. Ao voltar, recebe o estado completo e a partida continua. Recarregar a página do convidado também volta à partida (um token guardado no `sessionStorage` identifica o jogador).
- Sem reconexão em 60 s, a partida termina por abandono, a favor de quem ficou.
- Um terceiro jogador que abrir o link recebe "Esta sala já tem dois jogadores".

## Sinalização e rede: escolha e limitações

- **PeerJS** com o broker público gratuito (`0.peerjs.com`). Ele só troca as mensagens de sinalização (oferta, resposta e candidatos ICE) para abrir o canal. Os lances vão por um `RTCDataChannel` direto entre os navegadores, confiável e ordenado.
- O código da sala vira o ID do anfitrião no broker (com o prefixo `xadrez-p2p-v1-`). O link é `…/#/j/<código>`.
- **STUN público** (Google e Cloudflare, lista em `src/net/peer.ts`), sem TURN.

Limitações:

- **NAT simétrico / CGNAT / redes corporativas** podem impedir a conexão direta. Sem um servidor TURN não há como retransmitir. Para resolver, adicione um TURN em `ICE_SERVERS` (`src/net/peer.ts`), por exemplo um serviço pago ou um `coturn` próprio.
- O broker público é gratuito e sem garantia: se estiver fora do ar, não dá para criar ou entrar em salas (partidas já conectadas continuam).
- **O anfitrião não pode recarregar ou fechar a aba**: o estado da partida vive no navegador dele. Se fechar, o convidado vê o aviso e a partida termina por abandono depois de 60 s.
- A confiança no relógio é do anfitrião. Um anfitrião mal-intencionado que altere o código pode mentir sobre os tempos; os lances, não (o convidado recusa lance ilegal).
- O tempo de rede (latência) do lance do convidado conta no relógio dele.

## Peças e tabuleiros

O botão de engrenagem, no canto superior direito, abre as **Configurações**. Lá você escolhe o estilo das peças e o tema do tabuleiro. A escolha vale só para você: fica no `localStorage` do navegador e não vai para o adversário.

- Dados dos estilos e temas: `src/ui/settings.ts` (`PIECE_SETS` e `BOARD_THEMES`).
- Painel: `src/ui/settings-panel.ts`.
- Para adicionar um estilo de peças, crie `public/pieces/<id>/` com os 12 SVGs (`wK.svg` … `bP.svg`) e inclua o item em `PIECE_SETS`.

### Temas de tabuleiro (11)

Verde (padrão), Marrom, Azul, Grafite, Roxo, Coral, Oceano, Areia, Madeira, Mármore e Noite. São cores e gradientes CSS próprios do projeto.

### Estilos de peças (11) e licenças

Os 10 estilos além do padrão vêm do repositório do lichess (`lichess-org/lila`, pasta `public/piece/`), com as licenças registradas no `COPYING.md` dele. Escolhi só conjuntos com licença livre que permite uso e redistribuição.

| Pasta | Nome na tela | Autor | Licença |
|---|---|---|---|
| `classico` | Clássico (padrão) | Colin M.L. Burnett (Wikimedia Commons, `Chess_{k,q,r,b,n,p}{l,d}t45.svg`) | BSD (licença tripla GFDL/BSD/GPL; usado sob BSD) |
| `merida` | Merida | Armando Hernandez Marroquin | GPLv2+ |
| `chessnut` | Chessnut | Alexis Luengas | Apache 2.0 |
| `fantasy` | Fantasia | Maurizio Monge | MIT |
| `spatial` | Espacial | Maurizio Monge | MIT |
| `celtic` | Celta | Maurizio Monge | MIT |
| `rhosgfx` | Desenho | RhosGFX | CC0 1.0 |
| `totoy` | Totoy | Kosal Sen | CC BY 4.0 |
| `papercut` | Recorte | Nikolay Anzarov | CC BY 4.0 |
| `kiwen-suwi` | Kiwen Suwi | neverRare | CC BY 4.0 |
| `shapes` | Formas | flugsio | CC BY-SA 4.0 |

Alteração feita nos arquivos: incluí o atributo `viewBox` nos SVGs de `classico` e `kiwen-suwi`, para a peça escalar com a casa.
