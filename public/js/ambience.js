/* Trilha ambiente original, sintetizada com Web Audio: pads harmônicos + notas de feltro. */
(function (root) {
  'use strict';

  var AudioContext = root.AudioContext || root.webkitAudioContext;
  var context = null;
  var master = null;
  var padBus = null;
  var pluckBus = null;
  var delay = null;
  var delayFeedback = null;
  var delayWet = null;
  var groups = [];
  var chordTimer = null;
  var noteTimer = null;
  var chordIndex = 0;
  var noteIndex = 0;
  var enabled = false;

  var chords = [
    [146.83, 220.00, 277.18, 329.63, 440.00], // Ré maior com nona
    [123.47, 185.00, 220.00, 293.66, 369.99], // Si menor com sétima
    [98.00, 196.00, 246.94, 293.66, 440.00],  // Sol maior com nona
    [110.00, 164.81, 220.00, 293.66, 329.63]  // Lá suspenso
  ];
  var melody = [
    587.33, 440.00, 493.88, 659.25, 554.37, 440.00, 369.99, 493.88,
    440.00, 659.25, 587.33, 493.88, 369.99, 440.00, 554.37, 493.88
  ];

  function ensureAudio() {
    if (context || !AudioContext) return;
    context = new AudioContext();

    master = context.createGain();
    master.gain.value = 0.0001;
    var compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.08;
    compressor.release.value = 0.7;
    master.connect(compressor);
    compressor.connect(context.destination);

    padBus = context.createGain();
    padBus.gain.value = 0.56;
    padBus.connect(master);
    pluckBus = context.createGain();
    pluckBus.gain.value = 0.62;
    pluckBus.connect(master);

    delay = context.createDelay(3);
    delay.delayTime.value = 1.85;
    delayFeedback = context.createGain();
    delayFeedback.gain.value = 0.16;
    delayWet = context.createGain();
    delayWet.gain.value = 0.17;
    padBus.connect(delay);
    pluckBus.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(master);
  }

  function scheduleChord() {
    if (!enabled || !context) return;
    var now = context.currentTime;
    groups.forEach(function (group) {
      group.gain.gain.cancelScheduledValues(now);
      group.gain.gain.setTargetAtTime(0.0001, now, 1.3);
      group.oscillators.forEach(function (node) {
        try { node.stop(now + 5); } catch (e) { /* nó já terminou */ }
      });
      root.setTimeout(function () {
        group.nodes.forEach(function (node) { try { node.disconnect(); } catch (e) { /* nó já foi desconectado */ } });
      }, 5200);
    });
    groups = [];

    var filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1250;
    filter.Q.value = 0.45;
    var chordGain = context.createGain();
    chordGain.gain.setValueAtTime(0.0001, now);
    chordGain.gain.setTargetAtTime(0.72, now + 0.15, 2.0);
    filter.connect(chordGain);
    chordGain.connect(padBus);

    var nodes = [filter, chordGain];
    var oscillators = [];
    chords[chordIndex].forEach(function (frequency, index) {
      var osc = context.createOscillator();
      var voice = context.createGain();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.value = frequency;
      osc.detune.value = index % 2 ? -3 : 2;
      voice.gain.value = index === 0 ? 0.105 : 0.035;
      osc.connect(voice);
      voice.connect(filter);
      osc.start(now);
      nodes.push(osc, voice);
      oscillators.push(osc);
    });
    groups.push({ gain: chordGain, nodes: nodes, oscillators: oscillators });
    chordIndex = (chordIndex + 1) % chords.length;
    chordTimer = root.setTimeout(scheduleChord, 12000);
  }

  function scheduleNote() {
    if (!enabled || !context) return;
    var now = context.currentTime;
    var frequency = melody[noteIndex % melody.length];
    var pan = context.createStereoPanner ? context.createStereoPanner() : null;
    if (pan) pan.pan.value = noteIndex % 2 ? 0.22 : -0.22;
    var envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.11, now + 0.06);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 5.8);
    var tone = context.createOscillator();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    var overtone = context.createOscillator();
    var overtoneGain = context.createGain();
    overtone.type = 'sine';
    overtone.frequency.value = frequency * 2.01;
    overtoneGain.gain.value = 0.14;
    tone.connect(envelope);
    overtone.connect(overtoneGain);
    overtoneGain.connect(envelope);
    if (pan) {
      envelope.connect(pan);
      pan.connect(pluckBus);
    } else {
      envelope.connect(pluckBus);
    }
    tone.start(now);
    overtone.start(now);
    tone.stop(now + 6.1);
    overtone.stop(now + 6.1);
    root.setTimeout(function () {
      [tone, overtone, overtoneGain, envelope, pan].forEach(function (node) {
        if (node) try { node.disconnect(); } catch (e) { /* nó já foi desconectado */ }
      });
    }, 6300);
    noteIndex = (noteIndex + 1) % melody.length;
    noteTimer = root.setTimeout(scheduleNote, 4800);
  }

  function start() {
    if (!AudioContext) return Promise.reject(new Error('Web Audio indisponível'));
    if (!enabled) {
      try { ensureAudio(); } catch (e) { return Promise.reject(e); }
      if (!context) return Promise.reject(new Error('Não foi possível iniciar o áudio'));
      enabled = true;
      var now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0.16, now, 0.65);
      chordIndex = 0;
      noteIndex = 0;
      scheduleChord();
      noteTimer = root.setTimeout(scheduleNote, 2100);
    }
    return context.state === 'suspended' ? context.resume() : Promise.resolve();
  }

  function stop() {
    if (!enabled) return;
    enabled = false;
    root.clearTimeout(chordTimer);
    root.clearTimeout(noteTimer);
    chordTimer = noteTimer = null;
    if (!context) return;
    var now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(0.0001, now, 0.22);
    groups.forEach(function (group) {
      group.gain.gain.cancelScheduledValues(now);
      group.gain.gain.setTargetAtTime(0.0001, now, 0.2);
      group.oscillators.forEach(function (node) {
        try { node.stop(now + 1.5); } catch (e) { /* nó já terminou */ }
      });
      root.setTimeout(function () {
        group.nodes.forEach(function (node) { try { node.disconnect(); } catch (e) { /* nó já foi desconectado */ } });
      }, 1700);
    });
    groups = [];
    root.setTimeout(function () {
      if (!enabled && context && context.state === 'running' && context.suspend) context.suspend().catch(function () {});
    }, 1800);
  }

  root.ChessAmbience = {
    start: start,
    stop: stop,
    toggle: function () { return enabled ? (stop(), Promise.resolve(false)) : start().then(function () { return true; }); },
    isEnabled: function () { return enabled; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
