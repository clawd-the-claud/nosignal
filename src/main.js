import * as THREE from 'three';
import { lightUniforms } from './shaders.js';
import { Island, createSky, scatterProps, buildStructures, landmarks, createMarkers } from './world.js';
import { Watcher } from './entity.js';
import { Sound } from './audio.js';
import { Director } from './story.js';
import { Post } from './post.js';

// ============================================================================
//  NO SIGNAL — main
// ============================================================================

const CFG = {
  eye: 1.68,
  walk: 3.1,
  sprint: 6.0,
  accel: 11,
  turn: 0.0022,
  filmTime: 3.0,          // seconds to capture a location
  batteryOn: 0.0052,      // per second, torch
  batteryRec: 0.0115,     // extra while filming
  catchDist: 2.3,
  totalShots: 5,
};

/* --------------------------------------------------------------- setup */
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 900);

const uni = lightUniforms(THREE);
const rand = (() => { let s = 20260729; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();

const island = new Island(uni, scene);
scene.add(createSky(uni));
scatterProps(island, uni, scene, rand);
const build = buildStructures(island, uni, scene);
const MARKS = landmarks(island);
const markers = createMarkers(MARKS, uni, scene);

const watcher = new Watcher(island, uni, scene);
const sound = new Sound();
const director = new Director(sound);
const post = new Post(renderer);

/* --------------------------------------------------------------- state */
const S = {
  mode: 'title',
  t: 0,
  pos: new THREE.Vector3(0, 0, 95),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: -0.05,
  bob: 0, stepPhase: 0,
  torch: false,
  battery: 1,
  stamina: 1,
  recording: false,
  filmProgress: 0,
  filmTarget: null,
  filmed: new Set(),
  fear: 0, wrong: 0,
  hurt: 0, glitch: 0,
  fade: 1,
  dead: false,
  startedAt: 0,
  ambientTimer: 26,
  whisperTimer: 20,
  sightingDone: false,
};

const keys = {};
const input = { fwd: 0, str: 0, sprint: false, film: false };

/* --------------------------------------------------------------- input */
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyF') toggleTorch();
  if (e.code === 'KeyM') sound.setMuted(sound.enabled);
  if (['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('mousedown', e => {
  if (S.mode !== 'playing') return;
  if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch {} return; }
  if (e.button === 0) input.film = true;
  if (e.button === 2) toggleTorch();
});
addEventListener('mouseup', e => { if (e.button === 0) input.film = false; });
addEventListener('contextmenu', e => e.preventDefault());

addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || S.mode !== 'playing') return;
  S.yaw -= e.movementX * CFG.turn;
  S.pitch -= e.movementY * CFG.turn;
  S.pitch = Math.max(-1.35, Math.min(1.35, S.pitch));
});

document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('pointer', document.pointerLockElement !== canvas);
});

function toggleTorch() {
  if (S.mode !== 'playing') return;
  if (S.battery <= 0) return;
  S.torch = !S.torch;
  sound.beep(S.torch);
}

function readKeys() {
  input.fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  input.str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  input.sprint = !!(keys.ShiftLeft || keys.ShiftRight);
}

/* ----------------------------------------------------------------- HUD */
const $ = id => document.getElementById(id);
const HUD = {
  hud: $('hud'), vf: $('vf'), tc: $('tc'), batt: $('batt'), battf: $('battf'),
  stam: $('stam'), stamf: $('stamf'), shots: $('shots'), ret: $('ret'),
  cap: $('cap'), capfg: $('capfg'), prompt: $('prompt'), subs: $('subs'),
  who: document.querySelector('#subs .who'), line: document.querySelector('#subs .line'),
  fear: $('fear'),
};
const CIRC = 2 * Math.PI * 34;
HUD.capfg.style.strokeDasharray = CIRC;
HUD.capfg.style.strokeDashoffset = CIRC;

sound.onSubtitle = (text, who) => {
  if (!text) { HUD.subs.classList.remove('on'); return; }
  HUD.who.textContent = who === 'them' ? '' : 'me';
  HUD.line.textContent = text;
  HUD.subs.classList.toggle('them', who === 'them');
  HUD.subs.classList.add('on');
};

function setPrompt(html) {
  if (!html) { HUD.prompt.classList.remove('on'); return; }
  HUD.prompt.innerHTML = html;
  HUD.prompt.classList.add('on');
}

/* ----------------------------------------------------------- run flow */
async function start() {
  await sound.init();

  S.mode = 'playing';
  S.pos.set(0, 0, 95);
  S.vel.set(0, 0, 0);
  S.yaw = 0; S.pitch = -0.06;
  S.torch = true; S.battery = 1; S.stamina = 1;
  S.recording = false; S.filmProgress = 0; S.filmTarget = null;
  S.filmed.clear();
  S.fear = 0; S.wrong = 0; S.hurt = 0; S.glitch = 0;
  S.dead = false; S.startedAt = performance.now();
  S.ambientTimer = 26; S.whisperTimer = 20; S.sightingDone = false;

  director.clear();
  director.fired.clear();
  watcher.reset();
  markers.forEach(m => { m.visible = true; m.material.uniforms.uFade.value = 1; });

  $('title').classList.add('hide');
  $('dead').classList.add('hide');
  $('win').classList.add('hide');
  HUD.hud.classList.add('on');
  try { canvas.requestPointerLock(); } catch {}

  setTimeout(() => director.play('intro', 3, true), 900);
}

function die(reason) {
  if (S.dead) return;
  S.dead = true;
  S.mode = 'dead';
  director.clear();
  sound.scream();
  document.exitPointerLock?.();
  HUD.hud.classList.remove('on');
  $('deadSub').textContent = reason;
  $('deadStat').textContent = `${S.filmed.size} of ${CFG.totalShots} locations filmed`;
  setTimeout(() => $('dead').classList.remove('hide'), 1400);
}

function win() {
  S.mode = 'win';
  director.clear();
  document.exitPointerLock?.();
  HUD.hud.classList.remove('on');
  const secs = Math.round((performance.now() - S.startedAt) / 1000);
  $('winStat').textContent = `${CFG.totalShots} of ${CFG.totalShots} filmed · ${Math.floor(secs/60)}m ${secs%60}s ashore`;
  director.play('win', 5, true);
  setTimeout(() => $('win').classList.remove('hide'), 2600);
}

$('startBtn').addEventListener('click', start);
$('retryBtn').addEventListener('click', start);
$('againBtn').addEventListener('click', start);

/* -------------------------------------------------------------- resize */
let scale = 1;
function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 1.6) * scale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
}
addEventListener('resize', resize);
resize();

/* ---------------------------------------------------------------- loop */
const clock = new THREE.Clock();
const camDir = new THREE.Vector3();
const fwdV = new THREE.Vector3(), rightV = new THREE.Vector3(), wish = new THREE.Vector3();
const tmp = new THREE.Vector3();
let frames = 0, fpsAcc = 0, fpsN = 0, qCool = 3;

function loop() {
  requestAnimationFrame(loop);
  frame(clock.getDelta());
}

function frame(rawDt) {
  let dt = rawDt > 0 ? rawDt : 1 / 60;
  if (dt > 0.05) dt = 0.05;
  S.t += dt;
  uni.uTime.value = S.t;
  readKeys();

  const playing = S.mode === 'playing';

  /* ---- look ---------------------------------------------------------- */
  camera.rotation.order = 'YXZ';
  camera.rotation.set(S.pitch, S.yaw, 0);

  /* ---- move ---------------------------------------------------------- */
  if (playing) {
    fwdV.set(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
    rightV.set(Math.cos(S.yaw), 0, -Math.sin(S.yaw));
    wish.set(0, 0, 0)
      .addScaledVector(fwdV, input.fwd)
      .addScaledVector(rightV, input.str);
    const moving = wish.lengthSq() > 0.001;
    if (moving) wish.normalize();

    const wantSprint = input.sprint && moving && S.stamina > 0.02 && !S.recording;
    S.stamina += (wantSprint ? -0.30 : 0.19) * dt;
    S.stamina = Math.max(0, Math.min(1, S.stamina));

    const speed = (wantSprint ? CFG.sprint : CFG.walk) * (S.recording ? 0.45 : 1);
    const k = 1 - Math.exp(-dt * CFG.accel);
    S.vel.x += (wish.x * speed - S.vel.x) * k;
    S.vel.z += (wish.z * speed - S.vel.z) * k;

    // step, then refuse the step if it would put us in the sea or up a cliff
    const nx = S.pos.x + S.vel.x * dt;
    const nz = S.pos.z + S.vel.z * dt;
    const nh = island.heightAt(nx, nz);
    const here = island.heightAt(S.pos.x, S.pos.z);
    if (nh > 0.55 && nh - here < 2.6 * Math.max(dt, 0.016) * 40) {
      S.pos.x = nx; S.pos.z = nz;
    } else {
      S.vel.multiplyScalar(0.2);
    }
    S.pos.y = island.heightAt(S.pos.x, S.pos.z);

    // headbob + footsteps
    const sp = Math.hypot(S.vel.x, S.vel.z);
    S.stepPhase += sp * dt * 1.55;
    if (S.stepPhase > Math.PI) {
      S.stepPhase -= Math.PI;
      if (sp > 0.6) sound.step(wantSprint ? 0.85 : 0.4);
    }
    S.bob = Math.sin(S.stepPhase * 2) * Math.min(sp / CFG.walk, 1.4) * 0.045;
  }

  camera.position.set(S.pos.x, S.pos.y + CFG.eye + S.bob, S.pos.z);
  camera.updateMatrixWorld();
  camera.getWorldDirection(camDir);

  /* ---- phone --------------------------------------------------------- */
  if (playing) {
    if (S.torch) {
      S.battery -= (CFG.batteryOn + (S.recording ? CFG.batteryRec : 0)) * dt;
      if (S.battery <= 0) {
        S.battery = 0; S.torch = false; S.recording = false;
        sound.beep(false); sound.stinger(0.5);
      }
    }
  }
  const flicker = S.torch
    ? (0.86 + 0.14 * Math.sin(S.t * 31) * Math.sin(S.t * 7.3)) * (S.battery < 0.18 ? (Math.random() < 0.06 ? 0.15 : 1) : 1)
    : 0;
  uni.uTorchOn.value += (flicker - uni.uTorchOn.value) * (1 - Math.exp(-dt * 22));
  uni.uTorchPos.value.copy(camera.position);
  uni.uTorchDir.value.copy(camDir);

  /* ---- filming -------------------------------------------------------- */
  let target = null, canFilm = false;
  if (playing) {
    for (const mk of MARKS) {
      if (S.filmed.has(mk.id)) continue;
      tmp.set(mk.x - S.pos.x, 0, mk.z - S.pos.z);
      const d = tmp.length();
      if (d > mk.r) continue;
      tmp.normalize();
      if (tmp.dot(new THREE.Vector3(camDir.x, 0, camDir.z).normalize()) < 0.45) continue;
      target = mk; break;
    }
    canFilm = !!target && S.torch;

    if (target && !S.torch) setPrompt('Raise your phone — <kbd>RMB</kbd> or <kbd>F</kbd>');
    else if (canFilm) setPrompt(`Hold <kbd>LMB</kbd> to film — ${target.name}`);
    else if (S.filmed.size >= CFG.totalShots) setPrompt('Get back to the boat');
    else setPrompt(null);

    const wantRec = input.film && canFilm;
    if (wantRec !== S.recording) {
      S.recording = wantRec;
      sound.beep(wantRec);
      if (wantRec) director.play('cameraWarning', 1, true);
    }

    if (S.recording && target) {
      S.filmTarget = target;
      S.filmProgress += dt / CFG.filmTime;
      if (S.filmProgress >= 1) {
        S.filmProgress = 0;
        S.recording = false; input.film = false;
        S.filmed.add(target.id);
        const mi = MARKS.indexOf(target);
        if (markers[mi]) markers[mi].visible = false;
        sound.beep(false);
        director.play('film:' + target.id, 4, true);
        onFilmed();
      }
    } else {
      S.filmProgress = Math.max(0, S.filmProgress - dt * 0.7);
    }
  }

  /* ---- the watcher ---------------------------------------------------- */
  let entDist = 999;
  if (playing && watcher.awake) {
    entDist = watcher.update(dt, {
      playerPos: S.pos, camera, camDir, recording: S.recording, wrong: S.wrong,
      onHunt: () => { director.play('hunted', 3); sound.stinger(1.1); },
      onLost: () => { director.play('escaped', 2, true); },
    }) ?? 999;

    if (!S.sightingDone && watcher.seenBy(camera, camDir) && entDist < 62) {
      S.sightingDone = true;
      director.play('firstSighting', 3, true);
      sound.stinger(0.8);
    }
    if (entDist < CFG.catchDist) die('It found the camera');
  }

  /* ---- fear, escalation ----------------------------------------------- */
  const prox = watcher.awake ? Math.max(0, 1 - entDist / 42) : 0;
  const targetFear = Math.min(1, prox * (watcher.state === 'hunt' ? 1.25 : 0.6) + S.wrong * 0.22);
  S.fear += (targetFear - S.fear) * (1 - Math.exp(-dt * 2.6));
  S.glitch += ((watcher.state === 'hunt' ? prox * 0.95 : prox * 0.35) - S.glitch) * (1 - Math.exp(-dt * 4));
  S.hurt = Math.max(0, S.hurt - dt * 0.8);

  uni.uWrong.value += (S.wrong - uni.uWrong.value) * (1 - Math.exp(-dt * 0.5));
  uni.uFogDen.value = 0.024 + uni.uWrong.value * 0.020;
  uni.uAmbient.value.setRGB(
    0.020 - uni.uWrong.value * 0.008,
    0.026 - uni.uWrong.value * 0.014,
    0.040 - uni.uWrong.value * 0.020
  );

  /* ---- ambience ------------------------------------------------------- */
  if (playing) {
    S.ambientTimer -= dt;
    if (S.ambientTimer <= 0) {
      S.ambientTimer = 34 + Math.random() * 40;
      director.mutter('ambient');
    }
    S.whisperTimer -= dt;
    if (S.whisperTimer <= 0) {
      S.whisperTimer = Math.max(5, 22 - S.wrong * 14) + Math.random() * 12;
      if (S.wrong > 0.2) {
        sound.whisper();
        if (Math.random() < 0.30 + S.wrong * 0.3) director.mutter('whispers');
      }
    }

    // reached the boat with everything filmed
    if (S.filmed.size >= CFG.totalShots) {
      const d = Math.hypot(S.pos.x - 0, S.pos.z - 104);
      if (d < 40) director.play('boatClose', 2, true);
      if (d < 12) win();
    }
  }

  /* ---- lighthouse ----------------------------------------------------- */
  if (build.beam) {
    build.beam.rotation.y = -S.t * 0.34;
    build.lamp.material.color.setRGB(1, 0.90 - uni.uWrong.value * 0.55, 0.72 - uni.uWrong.value * 0.55);
  }

  /* ---- HUD ------------------------------------------------------------ */
  if (playing) {
    HUD.vf.classList.toggle('on', S.recording);
    HUD.batt.classList.toggle('low', S.battery < 0.2);
    HUD.battf.style.width = (S.battery * 100).toFixed(1) + '%';
    HUD.stam.classList.toggle('on', S.stamina < 0.98);
    HUD.stamf.style.width = (S.stamina * 100).toFixed(0) + '%';
    HUD.shots.innerHTML = `${S.filmed.size}<small>/${CFG.totalShots}</small>`;
    HUD.ret.classList.toggle('hot', !!target);
    HUD.cap.classList.toggle('on', S.filmProgress > 0.01);
    HUD.capfg.style.strokeDashoffset = CIRC * (1 - S.filmProgress);
    HUD.fear.style.opacity = (S.fear * 0.85).toFixed(2);
    if (S.recording) {
      const el = (performance.now() - S.startedAt) / 1000;
      const mm = String(Math.floor(el / 60)).padStart(2, '0');
      const ss = String(Math.floor(el % 60)).padStart(2, '0');
      const ff = String(Math.floor((el % 1) * 25)).padStart(2, '0');
      HUD.tc.textContent = `${mm}:${ss}:${ff}`;
    }
  }

  /* ---- audio + post --------------------------------------------------- */
  sound.update(dt, {
    fear: S.fear,
    exposure: Math.min(1, Math.max(0, (S.pos.y - 4) / 22)),
    nearShore: Math.max(0, 1 - Math.abs(Math.hypot(S.pos.x, S.pos.z) - 116) / 40),
    entityNear: prox,
    wrong: uni.uWrong.value,
  });

  S.fade += ((playing || S.mode === 'title' ? 0 : 0) - S.fade) * (1 - Math.exp(-dt * 1.4));
  if (S.mode === 'dead') S.fade = Math.min(1, S.fade + dt * 1.6);
  post.comp.uniforms.uTime.value = S.t;
  post.comp.uniforms.uFear.value = S.fear;
  post.comp.uniforms.uRec.value = S.recording ? 1 : 0;
  post.comp.uniforms.uGlitch.value = S.glitch;
  post.comp.uniforms.uHurt.value = S.hurt;
  post.comp.uniforms.uFade.value = Math.max(0, Math.min(1, S.fade));

  post.render(scene, camera);
  frames++;

  /* ---- adaptive resolution -------------------------------------------- */
  fpsAcc += dt; fpsN++; qCool -= dt;
  if (fpsN >= 50) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    if (qCool <= 0) {
      if (fps < 40 && scale > 0.6) { scale = Math.max(0.6, scale - 0.14); resize(); qCool = 4; }
      else if (fps > 57 && scale < 1) { scale = Math.min(1, scale + 0.1); resize(); qCool = 5; }
    }
  }
}

/** Called whenever a location is captured — this is the escalation ladder. */
function onFilmed() {
  const n = S.filmed.size;
  if (n >= 1 && !watcher.awake) {
    watcher.awake = true;
    watcher.relocate(S.pos, 48, 66);
  }
  if (n >= 2) S.wrong = Math.max(S.wrong, 0.28);
  if (n >= 3) { S.wrong = Math.max(S.wrong, 0.58); watcher.speed = 3.5; }
  if (n >= 4) { S.wrong = Math.max(S.wrong, 0.78); watcher.speed = 3.9; }
  if (n >= CFG.totalShots) {
    S.wrong = 1;
    watcher.speed = 4.4;
    watcher.attention = 1;
    setTimeout(() => director.play('reveal', 5, true), 1200);
    // the drowned, standing in the shallows
    spawnCrowd();
  }
}

/* ------------------------------------------- the ones already on the island */
function spawnCrowd() {
  const g = new THREE.Group();
  const mat = watcher.mat;
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + 0.2;
    const r = 122 + Math.random() * 16;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = Math.max(island.heightAt(x, z), -1.2);
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 1.5, 6), mat);
    body.position.y = 1.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), mat);
    head.position.y = 2.5;
    // arms up, holding something
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 4), mat);
    armL.position.set(-0.24, 2.1, 0.22); armL.rotation.x = 1.15;
    const armR = armL.clone(); armR.position.x = 0.24;
    p.add(body, head, armL, armR);
    p.position.set(x, y, z);
    p.lookAt(-42, y + 2, -94);            // all facing the lighthouse
    g.add(p);
  }
  scene.add(g);
}

/* --------------------------------------------------------------- boot */
window.NOSIGNAL = { S, CFG, scene, camera, island, watcher, sound, director, uni, post, input, MARKS, markers, start,
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); } };

const lfill = $('lfill');
function boot() {
  const p = Math.min(1, frames / 6);
  lfill.style.width = (p * 100) + '%';
  if (p >= 1) { $('loading').classList.add('hide'); S.fade = 0; return; }
  requestAnimationFrame(boot);
}
requestAnimationFrame(boot);
setTimeout(() => { $('loading').classList.add('hide'); S.fade = 0; }, 6000);

loop();
