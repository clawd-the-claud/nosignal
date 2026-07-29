import * as THREE from 'three';
import { NOISE, LIGHT, SKY_FRAG } from './shaders.js?v=3';

// ============================================================================
//  THE ISLAND
//  A heightmapped rock in the North Atlantic, its props, its five landmarks,
//  and the sea around it. The heightmap is built once on the CPU and reused
//  for both the mesh and collision, so what you walk on is exactly what you see.
// ============================================================================

export const SEA_LEVEL = 0;
const SIZE = 460;          // terrain extent, centred on the origin
const N = 256;             // grid resolution
const R_BEACH = 118;       // waterline
const R_FADE = 168;        // seabed beyond here

/* --------------------------------------------------------------- noise */
function h2(x, y) {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (h2(ix, iy) * (1 - ux) + h2(ix + 1, iy) * ux) * (1 - uy)
       + (h2(ix, iy + 1) * (1 - ux) + h2(ix + 1, iy + 1) * ux) * uy;
}
function fbm(x, y, oct = 5) {
  let a = 0.5, s = 0, px = x, py = y;
  for (let i = 0; i < oct; i++) {
    s += a * vn(px, py);
    const nx = px * 0.8 + py * 0.6, ny = -px * 0.6 + py * 0.8;
    px = nx * 2.03; py = ny * 2.03; a *= 0.5;
  }
  return s;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/** The island's shape. One function, used for the mesh and for walking on. */
function baseHeight(x, z) {
  const d = Math.hypot(x, z);

  let prof;
  if (d > R_FADE) prof = -11;
  else if (d > R_BEACH) prof = -11 * (d - R_BEACH) / (R_FADE - R_BEACH);
  else prof = 1.6 + (1 - d / R_BEACH) * 27;

  const relief = (fbm(x * 0.011, z * 0.011) - 0.5) * 27
               + (fbm(x * 0.042, z * 0.042, 3) - 0.5) * 5.5;
  const mask = clamp(prof / 7, 0, 1);
  return prof + relief * mask;
}

/* ================================================================ Terrain */
export class Island {
  constructor(uni, scene) {
    this.uni = uni;
    this.step = SIZE / N;
    this.half = SIZE / 2;

    // ---- bake the heightmap ------------------------------------------
    const H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -this.half + i * this.step;
        const z = -this.half + j * this.step;
        H[j * (N + 1) + i] = baseHeight(x, z);
      }
    }
    this.H = H;

    // ---- mesh ---------------------------------------------------------
    const vcount = (N + 1) * (N + 1);
    const pos = new Float32Array(vcount * 3);
    const nrm = new Float32Array(vcount * 3);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const x = -this.half + i * this.step;
        const z = -this.half + j * this.step;
        pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;

        const hl = H[j * (N + 1) + Math.max(i - 1, 0)];
        const hr = H[j * (N + 1) + Math.min(i + 1, N)];
        const hd = H[Math.max(j - 1, 0) * (N + 1) + i];
        const hu = H[Math.min(j + 1, N) * (N + 1) + i];
        const nx = hl - hr, nz = hd - hu, ny = 2 * this.step;
        const len = Math.hypot(nx, ny, nz) || 1;
        nrm[k * 3] = nx / len; nrm[k * 3 + 1] = ny / len; nrm[k * 3 + 2] = nz / len;
      }
    }
    const idx = new Uint32Array(N * N * 6);
    let m = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + N + 1;
        idx[m++] = a; idx[m++] = b; idx[m++] = a + 1;
        idx[m++] = a + 1; idx[m++] = b; idx[m++] = b + 1;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SIZE);

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: uni,
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vP;
        void main(){
          vN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0);
          vP = wp.xyz;
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vN; varying vec3 vP;
        ${NOISE}
        ${LIGHT}
        void main(){
          vec3 N = normalize(vN);
          float slope = 1.0 - clamp(N.y, 0.0, 1.0);

          float g1 = fbm2(vP.xz*0.09);
          float g2 = vnoise2(vP.xz*0.6);

          vec3 sand  = vec3(0.170,0.155,0.130) * (0.75 + 0.5*g2);
          vec3 moss  = vec3(0.066,0.092,0.055) * (0.62 + 0.85*g1);
          vec3 rock  = vec3(0.085,0.085,0.094) * (0.62 + 0.8*g2);
          vec3 peat  = vec3(0.052,0.046,0.037);

          vec3 alb = mix(moss, peat, smoothstep(0.35,0.75,g1));
          alb = mix(alb, rock, smoothstep(0.30, 0.62, slope));
          alb = mix(sand, alb, smoothstep(1.2, 5.0, vP.y));

          // wet, glossy right at the waterline
          float wet = 1.0 - smoothstep(0.2, 3.2, vP.y);
          alb *= mix(1.0, 0.55, wet);

          vec3 col = islandLight(alb, N, vP, 0.10 + wet*0.55);
          col = islandFog(col, length(vP - cameraPosition), vP);
          gl_FragColor = vec4(col, 1.0);
        }`
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._addSea(scene, uni);
  }

  /** Bilinear sample — the ground the player actually stands on. */
  heightAt(x, z) {
    const fx = (x + this.half) / this.step;
    const fz = (z + this.half) / this.step;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N || j >= N) return -11;
    const tx = fx - i, tz = fz - j;
    const H = this.H, w = N + 1;
    const h00 = H[j * w + i], h10 = H[j * w + i + 1];
    const h01 = H[(j + 1) * w + i], h11 = H[(j + 1) * w + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Surface steepness at a point, 0 flat .. 1 cliff. */
  slopeAt(x, z) {
    const e = 1.4;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return Math.min(1, Math.hypot(hr - hl, hu - hd) / (2 * e) * 0.55);
  }

  _addSea(scene, uni) {
    const geo = new THREE.PlaneGeometry(1500, 1500, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni,
      vertexShader: `varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vP;
        ${NOISE}
        ${LIGHT}
        void main(){
          vec2 q = vP.xz*0.05;
          float w1 = fbm2s(q + vec2(uTime*0.05, uTime*0.03));
          float w2 = vnoise2(q*3.4 - vec2(uTime*0.12, uTime*0.07));
          float e = 0.18;
          vec3 N = normalize(vec3(
            (fbm2s(q+vec2(e,0.0)) - w1)*-2.6, 1.0, (fbm2s(q+vec2(0.0,e)) - w1)*-2.6));

          vec3 deep = vec3(0.008,0.013,0.019);
          vec3 col = islandLight(deep, N, vP, 0.95);

          // moonlight scattering off the chop
          float glint = pow(max(dot(reflect(normalize(vP-cameraPosition), N), uMoonDir),0.0), 90.0);
          col += vec3(0.30,0.34,0.42)*glint*0.5;
          col += vec3(0.012,0.017,0.026)*smoothstep(0.45,0.9,w2);

          col = islandFog(col, length(vP - cameraPosition), vP);
          gl_FragColor = vec4(col,1.0);
        }`
    });
    const sea = new THREE.Mesh(geo, mat);
    sea.position.y = SEA_LEVEL;
    sea.frustumCulled = false;
    scene.add(sea);
    this.sea = sea;
  }
}

/* =================================================================== Sky */
export function createSky(uni) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: uni,
      vertexShader: `varying vec3 vDir; void main(){ vDir=normalize(position);
        vec4 p = projectionMatrix*mat4(mat3(modelViewMatrix))*vec4(position,1.0); gl_Position=p.xyww; }`,
      fragmentShader: SKY_FRAG,
    })
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/* ============================================================ Prop shader */
function propMaterial(uni, tint = [0.10, 0.10, 0.11], gloss = 0.1) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uTint: { value: new THREE.Vector3(...tint) }, uGloss: { value: gloss } }, uni),
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main(){
        vec4 wp = modelMatrix * instanceMatrixOrIdentity() * vec4(position,1.0);
        vN = normalize(mat3(modelMatrix)*mat3(instanceMatrixOrIdentity())*normal);
        vP = wp.xyz;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uTint; uniform float uGloss;
      varying vec3 vN; varying vec3 vP;
      ${NOISE}
      ${LIGHT}
      void main(){
        vec3 N = normalize(vN);
        vec3 alb = uTint * (0.7 + 0.6*fbm2s(vP.xz*1.6 + vP.y*0.4));
        vec3 col = islandLight(alb, N, vP, uGloss);
        col = islandFog(col, length(vP - cameraPosition), vP);
        gl_FragColor = vec4(col,1.0);
      }`
  });
}

// three injects instanceMatrix only for InstancedMesh; this keeps one shader
// usable for both by resolving to identity when the attribute isn't there.
const INSTANCE_SHIM = `
#ifdef USE_INSTANCING
  mat4 instanceMatrixOrIdentity(){ return instanceMatrix; }
#else
  mat4 instanceMatrixOrIdentity(){ return mat4(1.0); }
#endif
`;

function makePropMat(uni, tint, gloss) {
  const m = propMaterial(uni, tint, gloss);
  m.vertexShader = m.vertexShader.replace('varying vec3 vN;', INSTANCE_SHIM + '\nvarying vec3 vN;');
  return m;
}

/* ================================================================= Props */
function rockGeometry(seed, r) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = vn(x * 0.6 + seed * 13, z * 0.6 + y * 0.4 + seed * 7);
    const s = 0.62 + n * 0.75;
    p.setXYZ(i, x * s, y * s * 0.72, z * s);
  }
  g.computeVertexNormals();
  return g;
}

function deadTreeGeometry(seed) {
  const parts = [];
  const rnd = (() => { let s = seed * 3571 + 11; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
  const H = 5.5 + rnd() * 5;

  const trunk = new THREE.CylinderGeometry(0.10, 0.30, H, 6, 1);
  trunk.translate(0, H / 2, 0);
  const lean = (rnd() - 0.5) * 0.5;
  trunk.rotateZ(lean);
  parts.push(trunk);

  const nb = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < nb; i++) {
    const len = 1.4 + rnd() * 2.6;
    const b = new THREE.CylinderGeometry(0.035, 0.10, len, 4, 1);
    b.translate(0, len / 2, 0);
    b.rotateZ((rnd() - 0.5) * 2.2);
    b.rotateY(rnd() * 6.28);
    b.translate(0, H * (0.42 + rnd() * 0.5), 0);
    parts.push(b);
  }

  // merge by hand — no BufferGeometryUtils in the vendored build
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  const index = [];
  let off = 0;
  for (const p of parts) {
    const pa = p.attributes.position, na = p.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      pos[(off + i) * 3] = pa.getX(i); pos[(off + i) * 3 + 1] = pa.getY(i); pos[(off + i) * 3 + 2] = pa.getZ(i);
      nrm[(off + i) * 3] = na.getX(i); nrm[(off + i) * 3 + 1] = na.getY(i); nrm[(off + i) * 3 + 2] = na.getZ(i);
    }
    const pi = p.index;
    for (let i = 0; i < pi.count; i++) index.push(pi.getX(i) + off);
    off += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(index);
  return g;
}

export function scatterProps(island, uni, scene, rand) {
  const groups = [];

  // ---- rocks -----------------------------------------------------------
  const rockGeos = [0, 1, 2, 3].map(i => rockGeometry(i + 1, 0.8 + i * 0.55));
  const rockMat = makePropMat(uni, [0.090, 0.090, 0.100], 0.16);
  const perGeo = 90;
  for (const g of rockGeos) {
    const inst = new THREE.InstancedMesh(g, rockMat, perGeo);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0, guard = 0;
    while (n < perGeo && guard++ < perGeo * 30) {
      const a = rand() * 6.283, r = 12 + Math.sqrt(rand()) * 140;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = island.heightAt(x, z);
      if (y < 0.5) continue;
      v.set(x, y - 0.35, z);
      q.setFromEuler(new THREE.Euler(rand() * 0.5, rand() * 6.28, rand() * 0.5));
      s.setScalar(0.6 + rand() * 1.7);
      inst.setMatrixAt(n++, m.compose(v, q, s));
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    scene.add(inst); groups.push(inst);
  }

  // ---- dead trees ------------------------------------------------------
  const treeMat = makePropMat(uni, [0.080, 0.064, 0.050], 0.06);
  for (let k = 0; k < 3; k++) {
    const g = deadTreeGeometry(k + 5);
    const inst = new THREE.InstancedMesh(g, treeMat, 46);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0, guard = 0;
    while (n < 46 && guard++ < 46 * 30) {
      const a = rand() * 6.283, r = 20 + Math.sqrt(rand()) * 105;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = island.heightAt(x, z);
      if (y < 3.5 || island.slopeAt(x, z) > 0.45) continue;
      v.set(x, y - 0.2, z);
      q.setFromEuler(new THREE.Euler(0, rand() * 6.28, 0));
      s.setScalar(0.75 + rand() * 0.7);
      inst.setMatrixAt(n++, m.compose(v, q, s));
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    scene.add(inst); groups.push(inst);
  }

  return groups;
}

/* ============================================================ Structures */
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function addMesh(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  group.add(m);
  return m;
}

export function buildStructures(island, uni, scene) {
  const wood = makePropMat(uni, [0.115, 0.088, 0.064], 0.08);
  const stone = makePropMat(uni, [0.105, 0.105, 0.112], 0.12);
  const white = makePropMat(uni, [0.30, 0.30, 0.308], 0.18);
  const dark = makePropMat(uni, [0.020, 0.020, 0.024], 0.05);

  const out = {};

  /* ---- jetty: where the boat leaves you ------------------------------ */
  {
    const g = new THREE.Group();
    const z0 = 99;
    for (let i = 0; i < 16; i++) {
      const z = z0 + i * 2.2;
      const y = Math.max(island.heightAt(0, z), 0.2) + 0.9;
      addMesh(g, box(4.4, 0.16, 2.0), wood, 0, y, z);
      if (i % 2 === 0) {
        addMesh(g, box(0.24, 3.2, 0.24), wood, -1.9, y - 1.7, z);
        addMesh(g, box(0.24, 3.2, 0.24), wood, 1.9, y - 1.7, z);
      }
    }
    scene.add(g); out.jetty = g;
  }

  /* ---- guesthouse ---------------------------------------------------- */
  {
    const g = new THREE.Group();
    const x = -58, z = 50, y = island.heightAt(x, z);
    g.position.set(x, y, z);
    g.rotation.y = 0.5;
    addMesh(g, box(11, 5.4, 8), white, 0, 2.7, 0);
    const roof = new THREE.ConeGeometry(8.4, 3.4, 4);
    addMesh(g, roof, dark, 0, 7.1, 0, 0, Math.PI / 4);
    addMesh(g, box(1.3, 2.6, 0.3), dark, 0, 1.3, 4.05);            // doorway
    for (const [wx, wz] of [[-3.4, 4.05], [3.4, 4.05], [-5.55, 0], [5.55, 0]]) {
      addMesh(g, box(1.5, 1.4, 0.2), dark, wx, 3.3, wz, 0, wz === 0 ? Math.PI / 2 : 0);
    }
    addMesh(g, box(1.1, 2.6, 1.1), stone, 3.6, 8.0, 0);            // chimney
    scene.add(g); out.guesthouse = g;
  }

  /* ---- standing stones ----------------------------------------------- */
  {
    const g = new THREE.Group();
    const cx = 64, cz = 34;
    g.position.set(cx, island.heightAt(cx, cz), cz);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 7.5;
      const hgt = 3.4 + (i % 3) * 1.1;
      const m = addMesh(g, box(1.15, hgt, 0.65), stone,
        Math.cos(a) * r, hgt / 2 - 0.3, Math.sin(a) * r, (i % 2 ? 0.05 : -0.04), -a, 0);
      m.userData.stone = true;
    }
    scene.add(g); out.stones = g;
  }

  /* ---- chapel --------------------------------------------------------- */
  {
    const g = new THREE.Group();
    const x = 16, z = -68;
    g.position.set(x, island.heightAt(x, z), z);
    g.rotation.y = -0.35;
    addMesh(g, box(7.5, 4.6, 12), stone, 0, 2.3, 0);
    const roof = new THREE.ConeGeometry(6.0, 3.0, 4);
    addMesh(g, roof, dark, 0, 6.1, 0, 0, Math.PI / 4);
    addMesh(g, box(2.6, 7.5, 2.6), stone, 0, 3.75, -7.0);
    const spire = new THREE.ConeGeometry(2.1, 3.4, 4);
    addMesh(g, spire, dark, 0, 9.2, -7.0, 0, Math.PI / 4);
    addMesh(g, box(1.2, 2.4, 0.3), dark, 0, 1.2, 6.05);
    scene.add(g); out.chapel = g;
  }

  /* ---- lighthouse ----------------------------------------------------- */
  {
    const g = new THREE.Group();
    const x = -42, z = -94;
    const base = island.heightAt(x, z);
    g.position.set(x, base, z);
    const tower = new THREE.CylinderGeometry(2.1, 3.2, 20, 14, 1);
    addMesh(g, tower, white, 0, 10, 0);
    addMesh(g, new THREE.CylinderGeometry(3.0, 3.0, 0.6, 16), dark, 0, 20.2, 0);
    addMesh(g, new THREE.CylinderGeometry(2.0, 2.0, 2.6, 14), dark, 0, 21.8, 0);
    const cap = new THREE.ConeGeometry(2.6, 2.0, 14);
    addMesh(g, cap, dark, 0, 24.2, 0);

    // the lamp, and its beam sweeping through the fog
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe9c0 })
    );
    lamp.position.set(0, 21.8, 0);
    g.add(lamp);
    out.lamp = lamp;

    const beamGeo = new THREE.ConeGeometry(5.5, 120, 20, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(60, 0, 0);
    const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: uni.uTime, uWrong: uni.uWrong },
      vertexShader: `varying vec3 vP; varying vec2 vUv; void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime, uWrong;
        varying vec3 vP; varying vec2 vUv;
        void main(){
          float along = 1.0 - vUv.x;
          float a = pow(1.0-along, 1.4) * 0.10;
          a *= smoothstep(0.0,0.12,along);
          vec3 c = mix(vec3(1.0,0.90,0.72), vec3(1.0,0.35,0.30), uWrong);
          gl_FragColor = vec4(c*a, a);
        }`
    }));
    beam.position.set(0, 21.8, 0);
    beam.frustumCulled = false;
    g.add(beam);
    out.beam = beam;

    scene.add(g); out.lighthouse = g;
  }

  return out;
}

/* ============================================================= Landmarks */
export function landmarks(island) {
  const at = (x, z) => ({ x, y: island.heightAt(x, z), z });
  return [
    { id: 'jetty',      name: 'The Jetty',          ...at(0, 104),  r: 15 },
    { id: 'guesthouse', name: 'The Guesthouse',     ...at(-58, 50), r: 13 },
    { id: 'stones',     name: 'The Standing Stones',...at(64, 34),  r: 13 },
    { id: 'chapel',     name: 'The Chapel',         ...at(16, -68), r: 13 },
    { id: 'lighthouse', name: 'The Lighthouse',     ...at(-42, -94),r: 15 },
  ];
}

/** A faint column of light over each place you still have to film. */
export function createMarkers(marks, uni, scene) {
  const geo = new THREE.CylinderGeometry(1.5, 3.2, 46, 12, 1, true);
  geo.translate(0, 23, 0);
  const group = new THREE.Group();
  const meshes = [];
  for (const mk of marks) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: uni.uTime, uFade: { value: 1 }, uWrong: uni.uWrong },
      vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime, uFade, uWrong;
        varying vec2 vUv; varying vec3 vP;
        void main(){
          float up = 1.0 - vUv.y;
          float a = pow(up, 2.0) * 0.16 * uFade;
          a *= 0.75 + 0.25*sin(uTime*1.3 + vP.x*0.1);
          float edge = sin(vUv.x*3.14159);
          a *= edge;
          vec3 c = mix(vec3(0.55,0.80,0.95), vec3(1.0,0.42,0.42), uWrong);
          gl_FragColor = vec4(c*a, a);
        }`
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(mk.x, mk.y, mk.z);
    m.frustumCulled = false;
    group.add(m);
    meshes.push(m);
  }
  scene.add(group);
  return meshes;
}
