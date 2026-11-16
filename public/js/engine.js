/* Motor de xadrez puro — compartilhado entre cliente (navegador) e servidor (Node).
   Tabuleiro: linha 0 = rank 8 (pretas), linha 7 = rank 1 (brancas). Col 0 = fileira a. */
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';

  function sqName(r, c) { return FILES[c] + (8 - r); }
  function inBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function opp(color) { return color === 'w' ? 'b' : 'w'; }

  function initialState() {
    var back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    var board = [];
    var r, c;
    for (r = 0; r < 8; r++) board.push([null, null, null, null, null, null, null, null]);
    for (c = 0; c < 8; c++) {
      board[0][c] = { type: back[c], color: 'b' };
      board[1][c] = { type: 'p', color: 'b' };
      board[6][c] = { type: 'p', color: 'w' };
      board[7][c] = { type: back[c], color: 'w' };
    }
    return {
      board: board,
      turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null, // {r,c} casa que pode ser capturada en passant
      halfmove: 0,
      fullmove: 1
    };
  }

  function cloneState(s) {
    return {
      board: s.board.map(function (row) {
        return row.map(function (p) { return p ? { type: p.type, color: p.color } : null; });
      }),
      turn: s.turn,
      castling: { wK: s.castling.wK, wQ: s.castling.wQ, bK: s.castling.bK, bQ: s.castling.bQ },
      enPassant: s.enPassant ? { r: s.enPassant.r, c: s.enPassant.c } : null,
      halfmove: s.halfmove,
      fullmove: s.fullmove
    };
  }

  function findKing(s, color) {
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        if (p && p.type === 'k' && p.color === color) return { r: r, c: c };
      }
    return null;
  }

  var KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function isAttacked(s, r, c, by) {
    var i, nr, nc, p;
    // peões
    var dir = by === 'w' ? 1 : -1; // peão branco ataca para cima (r-1), logo ele está em r+1
    var pr = r + dir;
    for (i = -1; i <= 1; i += 2) {
      nc = c + i;
      if (inBoard(pr, nc)) {
        p = s.board[pr][nc];
        if (p && p.color === by && p.type === 'p') return true;
      }
    }
    // cavalos
    for (i = 0; i < KNIGHT.length; i++) {
      nr = r + KNIGHT[i][0]; nc = c + KNIGHT[i][1];
      if (inBoard(nr, nc)) {
        p = s.board[nr][nc];
        if (p && p.color === by && p.type === 'n') return true;
      }
    }
    // rei
    for (i = 0; i < KING.length; i++) {
      nr = r + KING[i][0]; nc = c + KING[i][1];
      if (inBoard(nr, nc)) {
        p = s.board[nr][nc];
        if (p && p.color === by && p.type === 'k') return true;
      }
    }
    // deslizantes diagonais (bispo/dama)
    for (i = 0; i < DIAG.length; i++) {
      nr = r; nc = c;
      while (true) {
        nr += DIAG[i][0]; nc += DIAG[i][1];
        if (!inBoard(nr, nc)) break;
        p = s.board[nr][nc];
        if (p) {
          if (p.color === by && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
      }
    }
    // deslizantes ortogonais (torre/dama)
    for (i = 0; i < ORTH.length; i++) {
      nr = r; nc = c;
      while (true) {
        nr += ORTH[i][0]; nc += ORTH[i][1];
        if (!inBoard(nr, nc)) break;
        p = s.board[nr][nc];
        if (p) {
          if (p.color === by && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
      }
    }
    return false;
  }

  function inCheck(s, color) {
    var k = findKing(s, color);
    if (!k) return false;
    return isAttacked(s, k.r, k.c, opp(color));
  }

  function pseudoMoves(s, color) {
    var moves = [];
    var r, c, p, i, nr, nc, q;
    function add(fr, fc, tr, tc, extra) {
      var m = { from: { r: fr, c: fc }, to: { r: tr, c: tc } };
      if (extra) for (var k in extra) m[k] = extra[k];
      moves.push(m);
    }
    for (r = 0; r < 8; r++) {
      for (c = 0; c < 8; c++) {
        p = s.board[r][c];
        if (!p || p.color !== color) continue;
        if (p.type === 'p') {
          var dir = color === 'w' ? -1 : 1;
          var startRow = color === 'w' ? 6 : 1;
          var promoRow = color === 'w' ? 0 : 7;
          // avanço simples
          nr = r + dir;
          if (inBoard(nr, c) && !s.board[nr][c]) {
            if (nr === promoRow) {
              ['q', 'r', 'b', 'n'].forEach(function (pr) { add(r, c, nr, c, { promotion: pr }); });
            } else add(r, c, nr, c);
            // avanço duplo
            if (r === startRow && !s.board[r + 2 * dir][c]) add(r, c, r + 2 * dir, c, { doublePush: true });
          }
          // capturas
          for (i = -1; i <= 1; i += 2) {
            nc = c + i; nr = r + dir;
            if (!inBoard(nr, nc)) continue;
            var target = s.board[nr][nc];
            if (target && target.color !== color) {
              if (nr === promoRow) {
                ['q', 'r', 'b', 'n'].forEach(function (pr) { add(r, c, nr, nc, { promotion: pr }); });
              } else add(r, c, nr, nc);
            } else if (s.enPassant && s.enPassant.r === nr && s.enPassant.c === nc) {
              add(r, c, nr, nc, { enPassant: true });
            }
          }
        } else if (p.type === 'n' || p.type === 'k') {
          var deltas = p.type === 'n' ? KNIGHT : KING;
          for (i = 0; i < deltas.length; i++) {
            nr = r + deltas[i][0]; nc = c + deltas[i][1];
            if (!inBoard(nr, nc)) continue;
            var t = s.board[nr][nc];
            if (!t || t.color !== color) add(r, c, nr, nc);
          }
          if (p.type === 'k') {
            // roque
            var home = color === 'w' ? 7 : 0;
            if (r === home && c === 4 && !inCheck(s, color)) {
              var kSide = color === 'w' ? s.castling.wK : s.castling.bK;
              var qSide = color === 'w' ? s.castling.wQ : s.castling.bQ;
              if (kSide && !s.board[home][5] && !s.board[home][6] &&
                  s.board[home][7] && s.board[home][7].type === 'r' && s.board[home][7].color === color &&
                  !isAttacked(s, home, 5, opp(color)) && !isAttacked(s, home, 6, opp(color))) {
                add(r, c, home, 6, { castle: 'K' });
              }
              if (qSide && !s.board[home][3] && !s.board[home][2] && !s.board[home][1] &&
                  s.board[home][0] && s.board[home][0].type === 'r' && s.board[home][0].color === color &&
                  !isAttacked(s, home, 3, opp(color)) && !isAttacked(s, home, 2, opp(color))) {
                add(r, c, home, 2, { castle: 'Q' });
              }
            }
          }
        } else {
          var dirs = p.type === 'b' ? DIAG : p.type === 'r' ? ORTH : KING; // dama = todas
          for (i = 0; i < dirs.length; i++) {
            nr = r; nc = c;
            while (true) {
              nr += dirs[i][0]; nc += dirs[i][1];
              if (!inBoard(nr, nc)) break;
              var t2 = s.board[nr][nc];
              if (!t2) add(r, c, nr, nc);
              else {
                if (t2.color !== color) add(r, c, nr, nc);
                break;
              }
            }
          }
        }
      }
    }
    return moves;
  }

  function applyMove(s, m) {
    var ns = cloneState(s);
    var piece = ns.board[m.from.r][m.from.c];
    var captured = ns.board[m.to.r][m.to.c];
    ns.board[m.from.r][m.from.c] = null;

    if (m.enPassant) {
      captured = ns.board[m.from.r][m.to.c];
      ns.board[m.from.r][m.to.c] = null;
    }
    if (m.promotion) piece = { type: m.promotion, color: piece.color };
    ns.board[m.to.r][m.to.c] = piece;

    if (m.castle === 'K') {
      var home = piece.color === 'w' ? 7 : 0;
      ns.board[home][5] = ns.board[home][7];
      ns.board[home][7] = null;
    } else if (m.castle === 'Q') {
      var home2 = piece.color === 'w' ? 7 : 0;
      ns.board[home2][3] = ns.board[home2][0];
      ns.board[home2][0] = null;
    }

    // direitos de roque
    if (piece.type === 'k') {
      if (piece.color === 'w') { ns.castling.wK = false; ns.castling.wQ = false; }
      else { ns.castling.bK = false; ns.castling.bQ = false; }
    }
    if (piece.type === 'r') {
      if (m.from.r === 7 && m.from.c === 0) ns.castling.wQ = false;
      if (m.from.r === 7 && m.from.c === 7) ns.castling.wK = false;
      if (m.from.r === 0 && m.from.c === 0) ns.castling.bQ = false;
      if (m.from.r === 0 && m.from.c === 7) ns.castling.bK = false;
    }
    if (captured && captured.type === 'r') {
      if (m.to.r === 7 && m.to.c === 0) ns.castling.wQ = false;
      if (m.to.r === 7 && m.to.c === 7) ns.castling.wK = false;
      if (m.to.r === 0 && m.to.c === 0) ns.castling.bQ = false;
      if (m.to.r === 0 && m.to.c === 7) ns.castling.bK = false;
    }

    ns.enPassant = m.doublePush ? { r: (m.from.r + m.to.r) / 2, c: m.from.c } : null;
    ns.halfmove = (piece.type === 'p' || captured) ? 0 : s.halfmove + 1;
    if (s.turn === 'b') ns.fullmove = s.fullmove + 1;
    ns.turn = opp(s.turn);
    return ns;
  }

  function legalMoves(s, color) {
    color = color || s.turn;
    return pseudoMoves(s, color).filter(function (m) {
      var ns = applyMove(s, m);
      return !inCheck(ns, color);
    });
  }

  function findMove(s, from, to, promotion) {
    var moves = legalMoves(s);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c) {
        if (m.promotion) {
          if ((promotion || 'q') === m.promotion) return m;
        } else return m;
      }
    }
    return null;
  }

  function insufficientMaterial(s) {
    var pieces = [];
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        if (p && p.type !== 'k') pieces.push(p);
      }
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n')) return true;
    if (pieces.length === 2 && pieces.every(function (p) { return p.type === 'b'; })) return true;
    return false;
  }

  function status(s) {
    var moves = legalMoves(s);
    var check = inCheck(s, s.turn);
    if (moves.length === 0) {
      if (check) return { over: true, result: s.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', winner: opp(s.turn) };
      return { over: true, result: '1/2-1/2', reason: 'stalemate', winner: null };
    }
    if (s.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty', winner: null };
    if (insufficientMaterial(s)) return { over: true, result: '1/2-1/2', reason: 'material', winner: null };
    return { over: false, check: check, moves: moves.length };
  }

  function toSAN(before, move) {
    if (move.castle === 'K') return finishSAN(before, 'O-O');
    if (move.castle === 'Q') return finishSAN(before, 'O-O-O');
    var piece = before.board[move.from.r][move.from.c];
    var isCapture = !!before.board[move.to.r][move.to.c] || move.enPassant;
    var san = '';
    if (piece.type === 'p') {
      if (isCapture) san += FILES[move.from.c] + 'x';
      san += sqName(move.to.r, move.to.c);
      if (move.promotion) san += '=' + move.promotion.toUpperCase();
    } else {
      san += piece.type.toUpperCase();
      // desambiguação
      var others = legalMoves(before).filter(function (m) {
        return m.to.r === move.to.r && m.to.c === move.to.c &&
               !(m.from.r === move.from.r && m.from.c === move.from.c) &&
               before.board[m.from.r][m.from.c] && before.board[m.from.r][m.from.c].type === piece.type;
      });
      if (others.length > 0) {
        var sameFile = others.some(function (m) { return m.from.c === move.from.c; });
        var sameRank = others.some(function (m) { return m.from.r === move.from.r; });
        if (!sameFile) san += FILES[move.from.c];
        else if (!sameRank) san += String(8 - move.from.r);
        else san += sqName(move.from.r, move.from.c);
      }
      if (isCapture) san += 'x';
      san += sqName(move.to.r, move.to.c);
    }
    return finishSAN(before, san);
  }

  function finishSAN(before, san) {
    var after = applyMove(before, lastMoveCache);
    return san;
  }
  var lastMoveCache = null;
  // toSAN precisa do lance aplicado para +/# — embrulhamos:
  var _toSAN = toSAN;
  toSAN = function (before, move) {
    lastMoveCache = move;
    var san = _toSAN(before, move);
    var after = applyMove(before, move);
    var st = status(after);
    if (st.over && st.reason === 'checkmate') san += '#';
    else if (inCheck(after, after.turn)) san += '+';
    return san;
  };

  var api = {
    initialState: initialState,
    cloneState: cloneState,
    legalMoves: legalMoves,
    pseudoMoves: pseudoMoves,
    applyMove: applyMove,
    findMove: findMove,
    inCheck: inCheck,
    isAttacked: isAttacked,
    status: status,
    toSAN: toSAN,
    sqName: sqName,
    opp: opp
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChessEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
