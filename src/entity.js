import * as THREE from 'three';
import { NOISE, LIGHT } from './shaders.js?v=3';

// ============================================================================
//  THE WATCHER
//  It is drawn to the camera. Filming is the only way to finish the island and
//  the only thing that reliably brings it — that tension is the whole game.
//
//  STALK  it stands at the edge of the fog and does not move while you look
//  HUNT   it walks you down, faster than you can walk and slower than you sprint
//  CATCH  contact
// ============================================================================

const STALK = 'stalk', HUNT = 'hunt', GONE = 'gone';

export class Watcher {
  constructor(island, uni, scene) {
    this.island = island;
    this.uni = uni;
    this.state = GONE;
    this.attention = 0;         // 0..1 — how much it wants you
    this.pos = new THREE.Vector3(0, 0, -200);
    this.vel = new THREE.Vector3();
    this.speed = 3.05;
    this.awake = false;
    this.stutter = 0;
    this._t = 0;
    this._relocTimer = 0;

    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const mat = new THREE.ShaderMaterial({
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
          vec3 V = normalize(cameraPosition - vP);

          // It is a hole, not a surface. Almost no diffuse response, so the
          // torch barely helps — you get a silhouette and a wet edge.
          float fres = pow(1.0 - max(dot(N,V),0.0), 2.6);
          vec3 col = vec3(0.004,0.004,0.006);
          col += vec3(0.20,0.22,0.26) * fres * 0.55;

          vec3 toL = uTorchPos - vP;
          float d = length(toL);
          float spot = smoothstep(uTorchCos, uTorchCos+0.16, dot(-normalize(toL), uTorchDir));
          col += vec3(0.16,0.15,0.13) * spot * uTorchOn / (1.0 + d*d*0.02) * (0.25 + fres);

          col = islandFog(col, length(vP - cameraPosition), vP);
          gl_FragColor = vec4(col,1.0);
        }`
    });
    this.mat = mat;

    const add = (geo, x, y, z, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz;
      this.group.add(m);
      return m;
    };

    // Too tall and too thin. Proportion does the work here, not detail.
    add(new THREE.CylinderGeometry(0.19, 0.26, 1.55, 7), 0, 1.72, 0);       // torso
    add(new THREE.SphereGeometry(0.20, 10, 8), 0, 2.62, 0.02);              // head
    this.armL = add(new THREE.CylinderGeometry(0.055, 0.075, 1.65, 5), -0.30, 1.62, 0);
    this.armR = add(new THREE.CylinderGeometry(0.055, 0.075, 1.65, 5), 0.30, 1.62, 0);
    this.legL = add(new THREE.CylinderGeometry(0.070, 0.090, 1.10, 5), -0.13, 0.52, 0);
    this.legR = add(new THREE.CylinderGeometry(0.070, 0.090, 1.10, 5), 0.13, 0.52, 0);
    for (const a of [this.armL, this.armR]) a.geometry.translate(0, -0.6, 0);
  }

  reset() {
    this.state = GONE;
    this.attention = 0;
    this.awake = false;
    this.group.visible = false;
    this.pos.set(0, 0, -200);
  }

  /** Put it somewhere out in the fog, roughly in front of the player. */
  relocate(playerPos, minD = 34, maxD = 58) {
    const a = Math.random() * Math.PI * 2;
    const d = minD + Math.random() * (maxD - minD);
    let x = playerPos.x + Math.cos(a) * d;
    let z = playerPos.z + Math.sin(a) * d;
    const r = Math.hypot(x, z);
    if (r > 112) { x *= 112 / r; z *= 112 / r; }        // keep it on the island
    this.pos.set(x, this.island.heightAt(x, z), z);
    this.state = STALK;
    this.group.visible = true;
  }

  /** Is it inside the view cone and close enough to register? */
  seenBy(camera, camDir) {
    const to = new THREE.Vector3().subVectors(this.pos, camera.position);
    const d = to.length();
    if (d > 90) return false;
    to.normalize();
    return to.dot(camDir) > 0.62;
  }

  update(dt, ctx) {
    if (!this.awake) return;
    this._t += dt;

    const { playerPos, camera, camDir, recording, fogDen } = ctx;
    const to = new THREE.Vector3().subVectors(playerPos, this.pos);
    const dist = to.length();
    to.y = 0; to.normalize();

    // ---- attention -----------------------------------------------------
    // Filming pours it in; distance and silence let it drain.
    const near = Math.max(0, 1 - dist / 60);
    this.attention += (recording ? 0.30 + near * 0.42 : -0.13 - Math.max(0, 1 - near) * 0.06) * dt;
    this.attention = Math.min(1, Math.max(0, this.attention));

    if (this.state === STALK && this.attention > 0.62) {
      this.state = HUNT;
      ctx.onHunt && ctx.onHunt();
    }
    if (this.state === HUNT && this.attention < 0.16 && dist > 34) {
      this.state = STALK;
      ctx.onLost && ctx.onLost();
      this.relocate(playerPos, 46, 70);
    }

    // ---- movement ------------------------------------------------------
    if (this.state === HUNT) {
      // Stutters: it stops dead, then covers ground. Constant velocity reads
      // as a machine; hesitation reads as something deciding.
      this.stutter -= dt;
      if (this.stutter < -1.6) this.stutter = Math.random() < 0.4 ? 0.35 : 0;
      const moving = this.stutter <= 0;
      const sp = this.speed * (moving ? 1 : 0) * (1 + ctx.wrong * 0.35);
      this.pos.x += to.x * sp * dt;
      this.pos.z += to.z * sp * dt;
      this.pos.y = this.island.heightAt(this.pos.x, this.pos.z);
    } else if (this.state === STALK) {
      // It only moves when unobserved.
      const seen = this.seenBy(camera, camDir);
      this._relocTimer -= dt;
      if (!seen && this._relocTimer <= 0 && dist < 30) {
        this.relocate(playerPos, 40, 62);
        this._relocTimer = 4;
      }
      if (!seen) {
        const sp = 1.5 * dt;
        this.pos.x += to.x * sp;
        this.pos.z += to.z * sp;
        this.pos.y = this.island.heightAt(this.pos.x, this.pos.z);
      }
    }

    // ---- pose ----------------------------------------------------------
    this.group.position.copy(this.pos);
    this.group.lookAt(playerPos.x, this.pos.y + 1.7, playerPos.z);

    const walk = this.state === HUNT && this.stutter <= 0 ? 1 : 0;
    const sw = Math.sin(this._t * 4.4) * 0.5 * walk;
    this.armL.rotation.x = sw * 0.7;
    this.armR.rotation.x = -sw * 0.7;
    this.legL.rotation.x = -sw;
    this.legR.rotation.x = sw;
    this.group.position.y += Math.sin(this._t * 8.8) * 0.035 * walk;

    return dist;
  }

  distanceTo(p) { return this.pos.distanceTo(p); }
}
