/* Material-rendered Staunton PNG pieces from chess-fen2img-2 wood set. */
(function(root){
  'use strict';
  var api = { w: {}, b: {} };
  ['w', 'b'].forEach(function(side) {
    ['p', 'n', 'b', 'r', 'q', 'k'].forEach(function(type) {
      api[side][type] = '<img class="piece-art" src="/img/pieces/' + side + '-' + type + '.png" alt="" draggable="false">';
    });
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChessPieces = api;
})(typeof window !== 'undefined' ? window : globalThis);
