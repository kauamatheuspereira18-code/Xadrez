/* Bot de xadrez: minimax com poda alfa-beta, ordenação de lances e tabelas
   de posição. Níveis: facil (prof. 1 + erros), intermediario (prof. 3),
   avancado (prof. 4 + busca de silêncio). */
(function (root) {
  'use strict';
  var E = root.ChessEngine;

  var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Tabelas de posição (perspectiva das brancas, linha 0 = rank 8)
  var PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 20, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ]
  };

  function evaluate(s) {
    var score = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        if (!p) continue;
        var idx = p.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
        var v = VAL[p.type] + PST[p.type][idx];
        score += p.color === 'w' ? v : -v;
      }
    }
    return score; // positivo = vantagem das brancas
  }

  function orderMoves(s, moves) {
    return moves
      .map(function (m) {
        var victim = s.board[m.to.r][m.to.c];
        var attacker = s.board[m.from.r][m.from.c];
        var sc = 0;
        if (victim) sc = 10 * VAL[victim.type] - VAL[attacker.type];
        if (m.promotion) sc += VAL[m.promotion];
        return { m: m, sc: sc };
      })
      .sort(function (a, b) { return b.sc - a.sc; })
      .map(function (x) { return x.m; });
  }

  function quiescence(s, alpha, beta, ply) {
    var stand = (s.turn === 'w' ? 1 : -1) * evaluate(s);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    var moves = orderMoves(s, E.legalMoves(s).filter(function (m) {
      return s.board[m.to.r][m.to.c] || m.enPassant || m.promotion;
    }));
    for (var i = 0; i < moves.length; i++) {
      var score = -quiescence(E.applyMove(s, moves[i]), -beta, -alpha, ply + 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(s, depth, alpha, beta, ply) {
    if (depth === 0) return quiescence(s, alpha, beta, ply);
    var moves = orderMoves(s, E.legalMoves(s));
    if (moves.length === 0) {
      if (E.inCheck(s, s.turn)) return -100000 + ply; // xeque-mate: prefere mate mais rápido
      return 0; // afogamento
    }
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var score = -negamax(E.applyMove(s, moves[i]), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  var LEVELS = {
    facil: { depth: 1, blunder: 0.35, randomTop: 0.5 },
    intermediario: { depth: 3, blunder: 0.05, randomTop: 0.15 },
    avancado: { depth: 4, blunder: 0, randomTop: 0.05 }
  };

  function bestMove(state, level) {
    var cfg = LEVELS[level] || LEVELS.intermediario;
    var moves = orderMoves(state, E.legalMoves(state));
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    if (Math.random() < cfg.blunder) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    var scored = [];
    var alpha = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var score = -negamax(E.applyMove(state, moves[i]), cfg.depth - 1, -Infinity, -alpha, 1);
      scored.push({ m: moves[i], score: score });
      if (score > alpha) alpha = score;
    }
    scored.sort(function (a, b) { return b.score - a.score; });

    // variedade: às vezes escolhe entre os melhores lances próximos
    var best = scored[0].score;
    var pool = scored.filter(function (x) { return x.score >= best - 30; });
    if (pool.length > 1 && Math.random() < cfg.randomTop) {
      return pool[Math.floor(Math.random() * pool.length)].m;
    }
    return scored[0].m;
  }

  var api = { bestMove: bestMove, evaluate: evaluate, LEVELS: LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChessBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
