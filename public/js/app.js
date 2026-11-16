/* Grand Chess — lógica da interface: tabuleiro, bot, online, relógio, sons. */
(function () {
  'use strict';
  var E = window.ChessEngine;
  var Bot = window.ChessBot;

  var GLYPH = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  };
  var NAMES = { k: 'Rei', q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo', p: 'Peão' };
  var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  // ── Estado global ──
  var nick = localStorage.getItem('gc_nick') || '';
  var mode = null; // 'bot' | 'online'
  var state = null; // estado do motor
  var history = []; // SANs
  var historyStack = []; // estados anteriores (desfazer no modo bot)
  var myColor = 'w';
  var botColor = 'b';
  var botLevel = 'intermediario';
  var orientation = 'w';
  var selected = null;
  var legalCache = [];
  var lastMove = null;
  var animateMove = false;
  var gameOver = null;
  var clock = { w: 0, b: 0, enabled: false };
  var clockTickAt = Date.now();
  var botThinking = false;
  var opponentName = 'Bot';
  var ws = null;
  var wsOpenCallbacks = [];
  var reconnectTimer = null;
  var heartbeatTimer = null;
  var reconnectDelay = 1000;
  var lastPongAt = 0;
  var reconnectNoticeShown = false;
  var pendingMove = false;
  var pendingMoveTimer = null;
  var roomCode = null;
  var roomPaused = false;
  var resumingSavedRoom = false;
  var playersInRoom = 1;
  var pendingPromo = null;
  var audioCtx = null;

  // ── Atalhos DOM ──
  function $(id) { return document.getElementById(id); }
  var boardEl = $('board');

  // Tabuleiro decorativo da entrada: mostra a qualidade visual antes de entrar.
  function buildLandingBoard() {
    var preview = $('landing-board');
    if (!preview || !window.ChessPieces) return;
    var position = [
      ['br','bn','bb','bq','bk','bb','bn','br'],
      ['bp','bp','bp','bp','bp','bp','bp','bp'],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  'bp','',  '',  ''],
      ['',  '',  '',  '',  'wp','',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['wp','wp','wp','wp','',  'wp','wp','wp'],
      ['wr','wn','wb','wq','wk','wb','wn','wr']
    ];
    position.forEach(function (row, r) {
      row.forEach(function (code, c) {
        var square = document.createElement('span');
        square.className = 'preview-square ' + ((r + c) % 2 ? 'dark' : 'light');
        if (['34','44'].indexOf(String(r) + c) !== -1) square.classList.add('preview-focus');
        if (code) {
          var piece = document.createElement('span');
          piece.className = 'preview-piece ' + code.charAt(0);
          piece.innerHTML = window.ChessPieces[code.charAt(0)][code.charAt(1)];
          square.appendChild(piece);
        }
        preview.appendChild(square);
      });
    });
  }
  buildLandingBoard();

  // ── Sons (WebAudio) ──
  function beep(freq, dur, type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sem áudio */ }
  }
  function sound(kind) {
    if (kind === 'move') beep(520, 0.07);
    else if (kind === 'capture') beep(220, 0.12, 'triangle');
    else if (kind === 'check') { beep(880, 0.1); setTimeout(function () { beep(880, 0.1); }, 120); }
    else if (kind === 'end') { beep(523, 0.15); setTimeout(function () { beep(659, 0.15); }, 150); setTimeout(function () { beep(784, 0.3); }, 300); }
    else if (kind === 'select') beep(700, 0.04);
  }

  // ── Navegação de telas ──
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.add('hidden'); }, 3200);
  }

  // Trilha ambiente: começa no primeiro gesto do jogador e pode ser silenciada a qualquer momento.
  var musicButton = $('btn-music');
  function renderMusicControl(active) {
    musicButton.classList.toggle('is-on', active);
    musicButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    musicButton.setAttribute('aria-label', active ? 'Desativar trilha sonora ambiente' : 'Ativar trilha sonora ambiente');
    $('music-state').textContent = active ? 'ATIVA · VOLUME BAIXO' : 'DESLIGADA';
  }
  function setAmbientMusic(active, notifyOnError) {
    if (!active) {
      window.ChessAmbience.stop();
      localStorage.setItem('gc_ambience', 'off');
      renderMusicControl(false);
      return;
    }
    window.ChessAmbience.start().then(function () {
      if (!window.ChessAmbience.isEnabled()) return;
      localStorage.setItem('gc_ambience', 'on');
      renderMusicControl(true);
    }).catch(function () {
      renderMusicControl(false);
      if (notifyOnError) toast('Não foi possível iniciar o áudio neste navegador.');
    });
  }
  musicButton.addEventListener('click', function () {
    setAmbientMusic(!window.ChessAmbience.isEnabled(), true);
  });
  renderMusicControl(false);

  // ── Login ──
  function getResumeToken() {
    var token = localStorage.getItem('gc_online_resume_token');
    if (!token) {
      token = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() :
        (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
      localStorage.setItem('gc_online_resume_token', token);
    }
    return token;
  }

  function doLogin() {
    var v = $('nick-input').value.trim();
    if (!v) { toast('Escolha um apelido para jogar.'); return; }
    nick = v;
    localStorage.setItem('gc_nick', nick);
    if (localStorage.getItem('gc_ambience') !== 'off' && !window.ChessAmbience.isEnabled()) setAmbientMusic(true, false);
    $('menu-nick').textContent = nick;
    var params = new URLSearchParams(location.search);
    var room = params.get('room') || localStorage.getItem('gc_online_room');
    if (room) {
      mode = 'online';
      roomCode = room.toUpperCase();
      resumingSavedRoom = !params.get('room');
      showScreen('screen-lobby');
      joinRoom(roomCode);
    } else {
      showScreen('screen-menu');
    }
  }
  $('btn-login').addEventListener('click', doLogin);
  $('nick-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  if (nick) $('nick-input').value = nick;

  $('btn-change-nick').addEventListener('click', function () { showScreen('screen-login'); $('nick-input').focus(); });

  // ── Tema ──
  var savedTheme = localStorage.getItem('gc_theme_atelier') || 'walnut';
  document.body.dataset.theme = savedTheme;
  $('theme-select').value = savedTheme;
  $('theme-select').addEventListener('change', function () {
    document.body.dataset.theme = this.value;
    localStorage.setItem('gc_theme_atelier', this.value);
  });

  // ── Menu ──
  $('mode-bot').addEventListener('click', function () { showScreen('screen-bot-setup'); });
  $('mode-online').addEventListener('click', function () {
    mode = 'online';
    var savedRoom = localStorage.getItem('gc_online_room');
    if (savedRoom) {
      roomCode = savedRoom;
      resumingSavedRoom = true;
      showScreen('screen-lobby');
      joinRoom(savedRoom);
      return;
    }
    showScreen('screen-lobby');
    beginRoomPolling();
  });

  // ── Segmentados (bot) ──
  function segInit(id, cb) {
    var el = $(id);
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        el.querySelectorAll('button').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        cb(b);
      });
    });
  }
  var LEVEL_DESC = {
    facil: 'Fácil: enxerga só 1 lance à frente e às vezes erra. Para aprender.',
    intermediario: 'Intermediário: enxerga 3 lances à frente. Bom desafio para a maioria.',
    avancado: 'Avançado: enxerga 4+ lances à frente com busca de silêncio. Jogue sério!'
  };
  segInit('bot-level', function (b) { botLevel = b.dataset.level; $('level-desc').textContent = LEVEL_DESC[botLevel]; });
  var botColorChoice = 'w';
  segInit('bot-color', function (b) { botColorChoice = b.dataset.color; });
  var botClockChoice = 600;
  segInit('bot-clock', function (b) { botClockChoice = parseInt(b.dataset.clock, 10); });

  $('btn-bot-back').addEventListener('click', function () { showScreen('screen-menu'); });

  $('btn-start-bot').addEventListener('click', function () {
    mode = 'bot';
    myColor = botColorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : botColorChoice;
    botColor = E.opp(myColor);
    opponentName = 'Bot ' + (botLevel === 'facil' ? 'Fácil' : botLevel === 'intermediario' ? 'Intermediário' : 'Avançado');
    startGame(botClockChoice);
  });

  // ── Início de partida ──
  function startGame(clockSeconds) {
    state = E.initialState();
    history = [];
    historyStack = [];
    selected = null;
    lastMove = null;
    gameOver = null;
    botThinking = false;
    orientation = myColor;
    clock = { w: clockSeconds || 0, b: clockSeconds || 0, enabled: !!clockSeconds };
    clockTickAt = Date.now();
    pendingMove = false;
    $('chat-box').classList.toggle('hidden', mode !== 'online');
    $('room-info-box').classList.toggle('hidden', mode !== 'online');
    $('btn-undo').classList.toggle('hidden', mode !== 'bot');
    $('btn-rematch').textContent = mode === 'bot' ? '↻ Jogar novamente' : '↻ Pedir revanche';
    showScreen('screen-game');
    renderAll();
    if (mode === 'bot' && state.turn === botColor) botTurn();
  }

  // ── Renderização ──
  function displaySquares() {
    var squares = [];
    for (var i = 0; i < 8; i++) {
      for (var j = 0; j < 8; j++) {
        var r = orientation === 'w' ? i : 7 - i;
        var c = orientation === 'w' ? j : 7 - j;
        squares.push({ r: r, c: c });
      }
    }
    return squares;
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    var checkKing = null;
    if (state && E.inCheck(state, state.turn)) {
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var p = state.board[r][c];
        if (p && p.type === 'k' && p.color === state.turn) checkKing = { r: r, c: c };
      }
    }
    displaySquares().forEach(function (sq) {
      var div = document.createElement('div');
      div.className = 'square ' + (((sq.r + sq.c) % 2 === 0) ? 'light' : 'dark');
      div.dataset.r = sq.r;
      div.dataset.c = sq.c;
      if (lastMove && ((lastMove.from.r === sq.r && lastMove.from.c === sq.c) || (lastMove.to.r === sq.r && lastMove.to.c === sq.c))) div.classList.add('last-move');
      if (selected && selected.r === sq.r && selected.c === sq.c) div.classList.add('selected');
      if (checkKing && checkKing.r === sq.r && checkKing.c === sq.c) div.classList.add('check');
      // coordenadas
      var isEdgeFile = orientation === 'w' ? sq.c === 0 : sq.c === 7;
      var isEdgeRank = orientation === 'w' ? sq.r === 7 : sq.r === 0;
      if (isEdgeFile) {
        var cr = document.createElement('span');
        cr.className = 'coord rank';
        cr.textContent = 8 - sq.r;
        div.appendChild(cr);
      }
      if (isEdgeRank) {
        var cf = document.createElement('span');
        cf.className = 'coord file';
        cf.textContent = 'abcdefgh'[sq.c];
        div.appendChild(cf);
      }
      // pontos de movimento legal
      if (selected) {
        var target = legalCache.find(function (m) { return m.to.r === sq.r && m.to.c === sq.c; });
        if (target) {
          var dot = document.createElement('span');
          dot.className = 'move-dot' + (state.board[sq.r][sq.c] || target.enPassant ? ' capture' : '');
          div.appendChild(dot);
        }
      }
      var piece = state ? state.board[sq.r][sq.c] : null;
      if (piece) {
        var sp = document.createElement('span');
        sp.className = 'piece ' + piece.color;
        sp.innerHTML = window.ChessPieces[piece.color][piece.type];
        sp.title = NAMES[piece.type];
        div.appendChild(sp);
      }
      boardEl.appendChild(div);
    });
    if (animateMove && lastMove) {
      animateMove = false;
      slidePiece(lastMove);
    }
  }

  // Anima a peça deslizando da casa de origem até o destino
  function slidePiece(move) {
    var rect = boardEl.getBoundingClientRect();
    var size = rect.width / 8;
    function disp(sq) {
      return {
        x: (orientation === 'w' ? sq.c : 7 - sq.c) * size,
        y: (orientation === 'w' ? sq.r : 7 - sq.r) * size
      };
    }
    var from = disp(move.from);
    var to = disp(move.to);
    var piece = state.board[move.to.r][move.to.c];
    if (!piece) return;
    // esconde a peça já renderizada no destino durante a animação
    var destEl = boardEl.querySelector('.square[data-r="' + move.to.r + '"][data-c="' + move.to.c + '"] .piece');
    if (destEl) destEl.style.opacity = '0';
    var ghost = document.createElement('div');
    ghost.className = 'slide-ghost piece ' + piece.color;
    ghost.innerHTML = window.ChessPieces[piece.color][piece.type];
    ghost.style.left = from.x + 'px';
    ghost.style.top = from.y + 'px';
    ghost.style.width = size + 'px';
    ghost.style.height = size + 'px';
    boardEl.appendChild(ghost);
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var anim = ghost.animate(
      [{ transform: 'translate(0,0) scale(1.12)' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(0.25, 0.9, 0.35, 1)' }
    );
    anim.onfinish = function () {
      ghost.remove();
      if (destEl) destEl.style.opacity = '';
    };
  }

  function capturedInfo() {
    var start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    var cur = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    var score = { w: 0, b: 0 };
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = state.board[r][c];
      if (p && p.type !== 'k') { cur[p.color][p.type]++; score[p.color] += VAL[p.type]; }
    }
    var capturedBy = { w: [], b: [] }; // peças pretas capturadas pelas brancas etc.
    ['w', 'b'].forEach(function (color) {
      var enemy = E.opp(color);
      ['q', 'r', 'b', 'n', 'p'].forEach(function (t) {
        var missing = start[t] - cur[enemy][t];
        for (var i = 0; i < missing; i++) capturedBy[color].push({ color: enemy, type: t });
      });
    });
    return { capturedBy: capturedBy, diff: score.w - score.b };
  }

  function renderPlayers() {
    var topColor = E.opp(orientation);
    var bottomColor = orientation;
    var info = capturedInfo();
    function nameFor(color) {
      if (mode === 'bot') return color === myColor ? nick + ' (você)' : opponentName;
      var pl = window._onlinePlayers || [];
      var found = pl.find(function (p) { return p.color === color; });
      return found ? found.name + (color === myColor ? ' (você)' : '') : (color === myColor ? nick + ' (você)' : 'Aguardando…');
    }
    $('name-top').textContent = nameFor(topColor);
    $('name-bottom').textContent = nameFor(bottomColor);
    $('avatar-top').innerHTML = window.ChessPieces[topColor].k;
    $('avatar-bottom').innerHTML = window.ChessPieces[bottomColor].k;
    function capturedHTML(color) {
      return info.capturedBy[color].map(function (p) {
        return '<span class="cap-piece">' + window.ChessPieces[p.color][p.type] + '</span>';
      }).join('');
    }
    $('captured-top').innerHTML = capturedHTML(topColor) +
      (topColor === 'w' && info.diff > 0 ? ' <span class="adv">+' + info.diff + '</span>' : '') +
      (topColor === 'b' && info.diff < 0 ? ' <span class="adv">+' + (-info.diff) + '</span>' : '');
    $('captured-bottom').innerHTML = capturedHTML(bottomColor) +
      (bottomColor === 'w' && info.diff > 0 ? ' <span class="adv">+' + info.diff + '</span>' : '') +
      (bottomColor === 'b' && info.diff < 0 ? ' <span class="adv">+' + (-info.diff) + '</span>' : '');
    $('bar-top').classList.toggle('active-turn', !!state && state.turn === topColor && !gameOver);
    $('bar-bottom').classList.toggle('active-turn', !!state && state.turn === bottomColor && !gameOver);
    renderClocks();
  }

  function fmtTime(sec) {
    if (!clock.enabled) return '--:--';
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function renderClocks() {
    var topColor = E.opp(orientation);
    $('clock-top').textContent = fmtTime(clock[topColor]);
    $('clock-bottom').textContent = fmtTime(clock[orientation]);
    $('clock-top').classList.toggle('low', clock.enabled && clock[topColor] <= 20);
    $('clock-bottom').classList.toggle('low', clock.enabled && clock[orientation] <= 20);
  }

  function renderHistory() {
    var el = $('move-history');
    if (history.length === 0) { el.innerHTML = '<p class="hint">Nenhum lance ainda.</p>'; return; }
    var html = '<table>';
    for (var i = 0; i < history.length; i += 2) {
      var isLast = i + 2 >= history.length;
      html += '<tr' + (isLast ? ' class="last"' : '') + '><td class="num">' + (i / 2 + 1) + '.</td><td>' + history[i] + '</td><td>' + (history[i + 1] || '') + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
    el.scrollTop = el.scrollHeight;
  }

  function renderStatus() {
    var el = $('status-line');
    if (gameOver) { el.textContent = gameOverText(gameOver); return; }
    if (mode === 'online' && roomPaused) { el.textContent = 'Partida pausada até os jogadores se reconectarem. O tempo está parado.'; return; }
    if (mode === 'online' && roomCode && (!ws || ws.readyState !== 1)) { el.textContent = 'Conexão instável. Reconectando e sincronizando a partida…'; return; }
    if (mode === 'online' && pendingMove) { el.textContent = 'Enviando seu lance…'; return; }
    if (mode === 'online' && playersInRoom < 2) { el.textContent = '⏳ Aguardando o adversário entrar na sala…'; return; }
    if (botThinking) { el.textContent = '🤖 Bot pensando…'; return; }
    if (state.turn === myColor) {
      el.textContent = E.inCheck(state, myColor) ? '⚠ Xeque! Sua vez de jogar.' : 'Sua vez de jogar.';
    } else {
      el.textContent = E.inCheck(state, state.turn) ? '⚠ Xeque no adversário!' : 'Vez do adversário.';
    }
  }

  function renderAll() {
    renderBoard();
    renderPlayers();
    renderHistory();
    renderStatus();
    $('thinking').classList.toggle('hidden', !botThinking);
  }

  // ── Relógio: calcula o tempo real decorrido, inclusive após abas em segundo plano ──
  setInterval(function () {
    var now = Date.now();
    var elapsed = Math.max(0, (now - clockTickAt) / 1000);
    clockTickAt = now;
    if (!state || !clock.enabled || gameOver || !$('screen-game').classList.contains('active')) return;
    if (mode === 'online' && playersInRoom < 2) return;
    clock[state.turn] = Math.max(0, clock[state.turn] - elapsed);
    if (clock[state.turn] <= 0 && mode === 'bot') {
      var loser = state.turn;
      onGameOver({ result: loser === 'w' ? '0-1' : '1-0', reason: 'timeout', winner: E.opp(loser) });
    }
    renderClocks();
  }, 250);

  // ── Interação com o tabuleiro (clique + arrastar) ──
  var drag = null; // {from, ghost, startX, startY, moved}

  function squareFromPoint(x, y) {
    var rect = boardEl.getBoundingClientRect();
    var c = Math.floor((x - rect.left) / rect.width * 8);
    var r = Math.floor((y - rect.top) / rect.height * 8);
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return { r: orientation === 'w' ? r : 7 - r, c: orientation === 'w' ? c : 7 - c };
  }

  function canPlay() {
    if (!state || gameOver || botThinking || pendingMove) return false;
    if (mode === 'online' && (!ws || ws.readyState !== 1 || roomPaused || playersInRoom < 2)) return false;
    return state.turn === myColor;
  }

  function selectSquare(sq) {
    selected = sq;
    legalCache = E.legalMoves(state).filter(function (m) { return m.from.r === sq.r && m.from.c === sq.c; });
    sound('select');
    renderBoard();
  }

  function clearSelection() {
    selected = null;
    legalCache = [];
    renderBoard();
  }

  function tryMove(from, to) {
    var move = E.findMove(state, from, to, 'q');
    if (!move) { clearSelection(); return; }
    if (move.promotion) { openPromo(from, to); return; }
    executeMove(move);
  }

  boardEl.addEventListener('pointerdown', function (e) {
    if (!canPlay()) return;
    var sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    var piece = state.board[sq.r][sq.c];

    // clicou num destino legal com seleção ativa
    if (selected && legalCache.some(function (m) { return m.to.r === sq.r && m.to.c === sq.c; })) {
      tryMove(selected, sq);
      return;
    }
    if (piece && piece.color === myColor) {
      selectSquare(sq);
      // inicia arrastar
      var ghost = document.createElement('div');
      ghost.className = 'drag-ghost piece ' + piece.color;
      ghost.innerHTML = window.ChessPieces[piece.color][piece.type];
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      document.body.appendChild(ghost);
      var pieceEl = boardEl.querySelector('.square[data-r="' + sq.r + '"][data-c="' + sq.c + '"] .piece');
      if (pieceEl) pieceEl.classList.add('dragging');
      drag = { from: sq, ghost: ghost, startX: e.clientX, startY: e.clientY, moved: false };
      boardEl.setPointerCapture && e.pointerId !== undefined && boardEl.setPointerCapture(e.pointerId);
    } else if (selected) {
      clearSelection();
    }
  });

  boardEl.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 6) drag.moved = true;
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
  });

  boardEl.addEventListener('pointerup', function (e) {
    if (!drag) return;
    var from = drag.from;
    drag.ghost.remove();
    drag = null;
    var sq = squareFromPoint(e.clientX, e.clientY);
    if (sq && !(sq.r === from.r && sq.c === from.c)) {
      tryMove(from, sq);
    }
    // se soltou na mesma casa, mantém seleção (modo clique)
  });

  // ── Promoção ──
  function openPromo(from, to) {
    pendingPromo = { from: from, to: to };
    var row = $('promo-row');
    row.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach(function (t) {
      var b = document.createElement('button');
      b.className = myColor;
      b.innerHTML = window.ChessPieces[myColor][t];
      b.title = NAMES[t];
      b.addEventListener('click', function () {
        $('promo-modal').classList.add('hidden');
        var move = E.findMove(state, pendingPromo.from, pendingPromo.to, t);
        pendingPromo = null;
        if (move) executeMove(move);
      });
      row.appendChild(b);
    });
    $('promo-modal').classList.remove('hidden');
  }

  // ── Execução de lance ──
  function executeMove(move) {
    var san = E.toSAN(state, move);
    var isCapture = !!state.board[move.to.r][move.to.c] || move.enPassant;
    if (mode === 'bot') {
      historyStack.push(state);
      state = E.applyMove(state, move);
      history.push(san);
      lastMove = move;
      animateMove = true;
      selected = null; legalCache = [];
      afterMove(isCapture);
      if (!gameOver) botTurn();
    } else {
      // Online: só envia com socket aberto; o servidor continua sendo a fonte oficial.
      if (!sendOnlineMessage({ type: 'move', move: { from: move.from, to: move.to, promotion: move.promotion } })) {
        renderAll();
        return;
      }
      pendingMove = true;
      clearPendingMoveTimer();
      pendingMoveTimer = setTimeout(function () {
        if (!pendingMove) return;
        if (!reconnectNoticeShown) toast('Sem resposta do servidor. Reconectando e recuperando a partida…');
        reconnectNoticeShown = true;
        if (ws) { try { ws.close(); } catch (e) {} }
        else scheduleReconnect(true);
      }, 10000);
      selected = null; legalCache = [];
      renderAll();
    }
  }

  function afterMove(isCapture) {
    var st = E.status(state);
    if (st.over) {
      onGameOver(st);
    } else if (E.inCheck(state, state.turn)) {
      sound('check');
    } else {
      sound(isCapture ? 'capture' : 'move');
    }
    renderAll();
  }

  function botTurn() {
    botThinking = true;
    renderAll();
    setTimeout(function () {
      var move = Bot.bestMove(state, botLevel);
      botThinking = false;
      if (!move) { renderAll(); return; }
      var san = E.toSAN(state, move);
      var isCapture = !!state.board[move.to.r][move.to.c] || move.enPassant;
      historyStack.push(state);
      state = E.applyMove(state, move);
      history.push(san);
      lastMove = move;
      animateMove = true;
      afterMove(isCapture);
    }, 380);
  }

  // ── Fim de jogo ──
  function gameOverText(go) {
    var who = go.winner === myColor ? 'Você venceu!' : go.winner ? 'Você perdeu.' : 'Empate.';
    var reason = {
      checkmate: 'Xeque-mate!',
      stalemate: 'Afogamento (sem lances legais).',
      resign: 'Desistência.',
      timeout: 'Tempo esgotado.',
      fifty: 'Regra dos 50 lances.',
      material: 'Material insuficiente.'
    }[go.reason] || '';
    return who + ' ' + reason + ' Resultado: ' + go.result;
  }

  function onGameOver(go) {
    gameOver = go;
    sound('end');
    renderAll();
    $('gameover-icon').textContent = go.winner === myColor ? '🏆' : go.winner ? '😞' : '🤝';
    $('gameover-title').textContent = go.winner === myColor ? 'Vitória!' : go.winner ? 'Derrota' : 'Empate';
    $('gameover-desc').textContent = gameOverText(go);
    setTimeout(function () { $('gameover-modal').classList.remove('hidden'); }, 600);
  }

  $('btn-rematch').addEventListener('click', function () {
    $('gameover-modal').classList.add('hidden');
    if (mode === 'bot') {
      startGame(clock.enabled ? clock.w || 600 : 0);
    } else if (sendOnlineMessage({ type: 'rematch' })) {
      toast('Revanche pedida! Aguardando o adversário aceitar…');
    }
  });

  $('btn-gameover-menu').addEventListener('click', function () {
    $('gameover-modal').classList.add('hidden');
    leaveGame();
  });

  // ── Ações da partida ──
  $('btn-flip').addEventListener('click', function () {
    orientation = E.opp(orientation);
    renderAll();
  });

  $('btn-undo').addEventListener('click', function () {
    if (mode !== 'bot' || botThinking || historyStack.length === 0) return;
    // desfaz o lance do bot + o seu (a pilha guarda o estado ANTES de cada lance)
    var pops = historyStack.length >= 2 ? 2 : 1;
    for (var i = 0; i < pops; i++) { historyStack.pop(); history.pop(); }
    state = historyStack.length ? historyStack[historyStack.length - 1] : E.initialState();
    gameOver = null;
    selected = null; legalCache = [];
    lastMove = null;
    renderAll();
  });

  var resignArmed = false;
  $('btn-resign').addEventListener('click', function () {
    if (gameOver) return;
    if (!resignArmed) {
      resignArmed = true;
      this.textContent = '⚠ Confirmar desistência?';
      var self = this;
      setTimeout(function () { resignArmed = false; self.textContent = '🏳 Desistir'; }, 3000);
      return;
    }
    resignArmed = false;
    this.textContent = '🏳 Desistir';
    if (mode === 'bot') {
      onGameOver({ result: myColor === 'w' ? '0-1' : '1-0', reason: 'resign', winner: botColor });
    } else {
      sendOnlineMessage({ type: 'resign' });
    }
  });

  $('btn-leave').addEventListener('click', leaveGame);

  function leaveGame() {
    if (mode === 'online') {
      // Keep the room code/token so a voluntary menu exit can still be resumed later.
      roomCode = null;
      roomPaused = false;
      pendingMove = false;
      clearPendingMoveTimer();
      reconnectNoticeShown = false;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { try { ws.close(); } catch (e) {} }
      ws = null;
      window._onlinePlayers = [];
    }
    mode = null;
    showScreen('screen-menu');
  }

  // ── Online: WebSocket com heartbeat e reconexão/sincronização automática ──
  function activeRoomNeedsReconnect() {
    return mode === 'online' && !!roomCode && $('screen-game').classList.contains('active');
  }

  function scheduleReconnect(immediate) {
    if (reconnectTimer || !activeRoomNeedsReconnect()) return;
    var wait = immediate ? 0 : reconnectDelay;
    reconnectDelay = Math.min(15000, reconnectDelay * 2);
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (activeRoomNeedsReconnect()) connectWS();
    }, wait);
  }

  function startHeartbeat(socket) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    lastPongAt = Date.now();
    heartbeatTimer = setInterval(function () {
      if (ws !== socket || socket.readyState !== 1 || document.visibilityState !== 'visible') return;
      if (Date.now() - lastPongAt > 45000) {
        try { socket.close(); } catch (e) {}
        return;
      }
      try { socket.send(JSON.stringify({ type: 'ping' })); }
      catch (e) { try { socket.close(); } catch (ignore) {} }
    }, 20000);
  }

  function clearPendingMoveTimer() {
    if (pendingMoveTimer) clearTimeout(pendingMoveTimer);
    pendingMoveTimer = null;
  }

  function sendOnlineMessage(message) {
    if (!ws || ws.readyState !== 1) {
      if (activeRoomNeedsReconnect()) scheduleReconnect(true);
      return false;
    }
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (e) {
      try { ws.close(); } catch (ignore) {}
      return false;
    }
  }

  function connectWS(cb) {
    if (cb) wsOpenCallbacks.push(cb);
    if (ws && (ws.readyState === 1 || ws.readyState === 0)) return;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var socket;
    try { socket = new WebSocket(proto + '//' + location.host); }
    catch (e) {
      wsOpenCallbacks = [];
      if (creatingRoom) resetCreateRoomButton();
      if (activeRoomNeedsReconnect()) scheduleReconnect();
      else toast('Não foi possível conectar ao servidor.');
      return;
    }
    ws = socket;
    socket.onopen = function () {
      if (ws !== socket) return;
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      startHeartbeat(socket);
      // Rejoin by the existing room and nickname; the server sends the authoritative state.
      if (activeRoomNeedsReconnect()) {
        try { socket.send(JSON.stringify({ type: 'join', name: nick, code: roomCode, resumeToken: getResumeToken() })); }
        catch (e) { try { socket.close(); } catch (ignore) {} return; }
      }
      var callbacks = wsOpenCallbacks.slice();
      wsOpenCallbacks = [];
      callbacks.forEach(function (callback) { try { callback(); } catch (e) { toast('Falha ao enviar a ação.'); } });
    };
    socket.onerror = function () {
      if (creatingRoom) resetCreateRoomButton();
      if (!activeRoomNeedsReconnect()) toast('Não foi possível conectar ao servidor.');
    };
    socket.onclose = function () {
      if (ws !== socket) return;
      ws = null;
      wsOpenCallbacks = [];
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (creatingRoom) resetCreateRoomButton();
      if (activeRoomNeedsReconnect()) {
        if (!reconnectNoticeShown) toast('Conexão interrompida. Tentando reconectar…');
        reconnectNoticeShown = true;
        renderAll();
        scheduleReconnect();
      }
    };
    socket.onmessage = function (ev) {
      if (ws !== socket) return;
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleServerMsg(msg);
    };
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !activeRoomNeedsReconnect()) return;
    if (!ws || ws.readyState !== 1) { scheduleReconnect(true); return; }
    var socket = ws;
    var pongBefore = lastPongAt;
    if (!sendOnlineMessage({ type: 'ping' })) return;
    setTimeout(function () {
      if (ws === socket && socket.readyState === 1 && lastPongAt <= pongBefore) {
        try { socket.close(); } catch (e) {}
      }
    }, 8000);
  });
  window.addEventListener('online', function () { if (activeRoomNeedsReconnect() && (!ws || ws.readyState !== 1)) scheduleReconnect(true); });
  window.addEventListener('pagehide', function () {
    if (mode === 'online' && roomCode && ws && ws.readyState === 1) {
      try { ws.close(1000, 'page hidden'); } catch (e) {}
    }
  });

  function connectedPlayerCount(players) {
    return (players || []).filter(function (player) { return player.connected !== false; }).length;
  }

  function handleServerMsg(msg) {
    if (msg.type === 'pong') { lastPongAt = Date.now(); return; }
    if (msg.type === 'roomList') { renderRoomList(msg.rooms); return; }
    if (msg.type === 'error') {
      if (creatingRoom) resetCreateRoomButton();
      if (resumingSavedRoom) {
        resumingSavedRoom = false;
        localStorage.removeItem('gc_online_room');
        localStorage.removeItem('gc_online_resume_token');
        roomCode = null;
        mode = null;
        showScreen('screen-menu');
        toast('Não foi possível retomar a sala. Ela pode ter expirado ou o servidor reiniciado.');
        return;
      }
      pendingMove = false;
      clearPendingMoveTimer();
      toast(msg.message);
      if (mode === 'online' && $('screen-game').classList.contains('active')) renderAll();
      if (mode === 'online' && $('screen-lobby').classList.contains('active')) refreshRoomList();
      return;
    }
    if (msg.type === 'joined') {
      stopRoomPolling();
      resetCreateRoomButton();
      roomCode = msg.code;
      localStorage.setItem('gc_online_room', msg.code);
      if (msg.yourResumeToken) localStorage.setItem('gc_online_resume_token', msg.yourResumeToken);
      resumingSavedRoom = false;
      roomPaused = !!msg.paused;
      myColor = msg.yourColor;
      state = msg.state;
      history = msg.history || [];
      lastMove = msg.lastMove || null;
      window._onlinePlayers = msg.players || [];
      playersInRoom = connectedPlayerCount(msg.players);
      gameOver = msg.over || null;
      clock = { w: msg.clock ? msg.clock.w : 600, b: msg.clock ? msg.clock.b : 600, enabled: true };
      clockTickAt = Date.now();
      pendingMove = false;
      clearPendingMoveTimer();
      if (reconnectNoticeShown) toast('Conexão restabelecida; partida sincronizada.');
      reconnectNoticeShown = false;
      $('chat-messages').innerHTML = '';
      addChat('Sistema', 'Você entrou na sala ' + msg.code + ' como ' + (myColor === 'w' ? 'brancas' : 'pretas') + '.', true);
      startGameOnline();
      return;
    }
    if (msg.type === 'move') {
      state = msg.state;
      history = msg.history || [];
      window._onlinePlayers = msg.players || [];
      playersInRoom = connectedPlayerCount(msg.players);
      roomPaused = !!msg.paused;
      clock = { w: msg.clock.w, b: msg.clock.b, enabled: true };
      clockTickAt = Date.now();
      pendingMove = false;
      clearPendingMoveTimer();
      lastMove = msg.lastMove || null;
      animateMove = !!msg.lastMove;
      selected = null; legalCache = [];
      if (msg.over) onGameOver(msg.over);
      else sound(E.inCheck(state, state.turn) ? 'check' : 'move');
      renderAll();
      return;
    }
    if (msg.type === 'gameOver') {
      state = msg.state;
      history = msg.history || [];
      window._onlinePlayers = msg.players || [];
      onGameOver(msg.over);
      return;
    }
    if (msg.type === 'opponentJoined') {
      window._onlinePlayers = msg.players || [];
      playersInRoom = connectedPlayerCount(msg.players);
      roomPaused = !!msg.paused;
      state = msg.state; history = msg.history || [];
      if (msg.clock) { clock = { w: msg.clock.w, b: msg.clock.b, enabled: true }; clockTickAt = Date.now(); }
      addChat('Sistema', 'Adversário entrou na sala! Boa partida.', true);
      renderAll();
      return;
    }
    if (msg.type === 'opponentLeft') {
      window._onlinePlayers = msg.players || [];
      playersInRoom = connectedPlayerCount(msg.players);
      roomPaused = !!msg.paused || playersInRoom < 2;
      addChat('Sistema', 'O adversário desconectou. Ele pode voltar com o mesmo apelido.', true);
      renderAll();
      return;
    }
    if (msg.type === 'opponentBack') {
      window._onlinePlayers = msg.players || [];
      playersInRoom = connectedPlayerCount(msg.players);
      roomPaused = !!msg.paused;
      if (msg.clock) { clock = { w: msg.clock.w, b: msg.clock.b, enabled: true }; clockTickAt = Date.now(); }
      addChat('Sistema', 'O adversário voltou! A partida continua.', true);
      renderAll();
      return;
    }
    if (msg.type === 'chat') { addChat(msg.from, msg.text); return; }
    if (msg.type === 'rematchOffer') {
      if (msg.waiting) return;
      toast(msg.from + ' quer jogar novamente! Clique em "Pedir revanche" para aceitar.');
      return;
    }
    if (msg.type === 'rematchStart') {
      state = msg.state;
      history = msg.history || [];
      window._onlinePlayers = msg.players || [];
      clock = { w: msg.clock.w, b: msg.clock.b, enabled: true };
      clockTickAt = Date.now();
      gameOver = null;
      pendingMove = false;
      lastMove = null;
      $('gameover-modal').classList.add('hidden');
      addChat('Sistema', 'Revanche! Nova partida começando.', true);
      renderAll();
      return;
    }
  }

  function startGameOnline() {
    // reaproveita startGame mas com estado vindo do servidor
    var keepState = state, keepHistory = history, keepClock = clock, keepOver = gameOver;
    startGame(600);
    state = keepState; history = keepHistory; clock = keepClock; gameOver = keepOver;
    orientation = myColor;
    $('chat-box').classList.remove('hidden');
    $('room-info-box').classList.remove('hidden');
    $('btn-undo').classList.add('hidden');
    renderAll();
    if (gameOver) $('gameover-modal').classList.remove('hidden');
  }

  // ── Lobby: salas públicas atualizadas pelo servidor e por polling leve ──
  var roomListTimer = null;
  var creatingRoom = false;
  function refreshRoomList() {
    connectWS(function () {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'listRooms' }));
    });
  }
  function stopRoomPolling() {
    if (roomListTimer) clearInterval(roomListTimer);
    roomListTimer = null;
  }
  function beginRoomPolling() {
    stopRoomPolling();
    refreshRoomList();
    roomListTimer = setInterval(function () {
      if (mode === 'online' && $('screen-lobby').classList.contains('active')) refreshRoomList();
      else stopRoomPolling();
    }, 6000);
  }
  function resetCreateRoomButton() {
    creatingRoom = false;
    var button = $('btn-create-room');
    if (!button) return;
    button.disabled = false;
    button.innerHTML = 'Criar sala <span>→</span>';
  }
  $('btn-create-room').addEventListener('click', function () {
    if (creatingRoom) return;
    creatingRoom = true;
    this.disabled = true;
    this.textContent = 'Abrindo sala…';
    connectWS(function () {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'create', name: nick, resumeToken: getResumeToken() }));
    });
  });

  function joinRoom(code) {
    if (!code) { toast('Essa partida não está disponível. Atualizando salas…'); refreshRoomList(); return; }
    connectWS(function () {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'join', name: nick, code: code, resumeToken: getResumeToken() }));
    });
  }
  $('btn-refresh-rooms').addEventListener('click', refreshRoomList);
  $('btn-lobby-back').addEventListener('click', function () {
    stopRoomPolling();
    if (resumingSavedRoom) {
      localStorage.removeItem('gc_online_room');
      localStorage.removeItem('gc_online_resume_token');
      resumingSavedRoom = false;
      roomCode = null;
    }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    mode = null;
    resetCreateRoomButton();
    showScreen('screen-menu');
  });

  function renderRoomList(rooms) {
    var el = $('open-rooms');
    rooms = Array.isArray(rooms) ? rooms : [];
    $('open-room-count').textContent = String(rooms.length);
    el.innerHTML = '';
    if (!rooms.length) {
      var empty = document.createElement('p');
      empty.className = 'setup-hint rooms-empty';
      empty.textContent = 'Nenhuma sala aberta ainda. Crie a primeira e aguarde alguém entrar.';
      el.appendChild(empty);
      return;
    }
    rooms.forEach(function (room) {
      var row = document.createElement('div');
      row.className = 'open-room';
      var icon = document.createElement('span');
      icon.className = 'room-player-icon';
      icon.textContent = '♙';
      var meta = document.createElement('span');
      meta.className = 'room-player-meta';
      var host = document.createElement('strong');
      host.className = 'room-player-name';
      host.textContent = room.host || 'Jogador';
      var waiting = document.createElement('small');
      waiting.textContent = 'Aguardando adversário · Brancas';
      meta.appendChild(host);
      meta.appendChild(waiting);
      var join = document.createElement('button');
      join.className = 'btn btn-secondary btn-small';
      join.textContent = 'Entrar';
      join.addEventListener('click', function () { joinRoom(room.code); });
      row.appendChild(icon);
      row.appendChild(meta);
      row.appendChild(join);
      el.appendChild(row);
    });
  }

  // ── Chat ──
  function addChat(from, text, system) {
    var box = $('chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg' + (!system && from === nick ? ' own' : '');
    if (system) {
      div.style.opacity = '0.75';
      div.style.fontStyle = 'italic';
      div.textContent = text;
    } else {
      div.innerHTML = '<strong></strong> ';
      div.querySelector('strong').textContent = from + ':';
      div.appendChild(document.createTextNode(text));
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  function sendChat() {
    var input = $('chat-input');
    var text = input.value.trim();
    if (!text) return;
    if (!sendOnlineMessage({ type: 'chat', text: text })) return;
    input.value = '';
  }
  $('btn-chat').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });

  // ── Inicialização ──
  if (nick) $('menu-nick').textContent = nick;
  var params = new URLSearchParams(location.search);
  if (params.get('room') && !nick) {
    // visitante com link de sala: pede apelido primeiro
    $('nick-input').placeholder = 'Escolha um apelido para entrar na sala ' + params.get('room').toUpperCase();
  }
})();
