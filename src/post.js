import * as THREE from 'three';
import { NOISE, ACES } from './shaders.js?v=4';

// ============================================================================
//  POST — the camcorder
//  Small bloom for the lamp and the torch, then a composite that does most of
//  the horror work: grain, heavy vignette, aberration that widens with fear,
//  and tape dropout when it is close.
// ============================================================================

const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;
const MIPS = 4;

class Quad {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(r, mat, target) {
    mat.depthTest = false; mat.depthWrite = false;
    this.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.cam);
  }
}

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.quad = new Quad();

    const o = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.scene = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false, samples: 4,
    });
    this.down = []; this.up = [];
    for (let i = 0; i < MIPS; i++) {
      this.down.push(new THREE.WebGLRenderTarget(2, 2, o));
      this.up.push(new THREE.WebGLRenderTarget(2, 2, o));
    }

    this.bright = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uThr: { value: 0.72 } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; uniform sampler2D uTex; uniform float uThr; varying vec2 vUv;
        void main(){ vec3 c=texture2D(uTex,vUv).rgb; float b=max(c.r,max(c.g,c.b));
          gl_FragColor=vec4(min(c*max(b-uThr,0.0)/max(b,1e-4), vec3(18.0)),1.0); }`
    });

    this.blur = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; uniform sampler2D uTex; uniform vec2 uTexel; varying vec2 vUv;
        vec3 T(vec2 o){ return texture2D(uTex, vUv+o*uTexel).rgb; }
        void main(){ vec3 s = T(vec2(-1,1))+T(vec2(0,1))*2.0+T(vec2(1,1))
          + T(vec2(-1,0))*2.0+T(vec2(0,0))*4.0+T(vec2(1,0))*2.0
          + T(vec2(-1,-1))+T(vec2(0,-1))*2.0+T(vec2(1,-1));
          gl_FragColor=vec4(s/16.0,1.0); }`
    });

    this.addMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `precision highp float; uniform sampler2D uTex; uniform vec2 uTexel; varying vec2 vUv;
        vec3 T(vec2 o){ return texture2D(uTex, vUv+o*uTexel).rgb; }
        void main(){ vec3 s = T(vec2(-1,1))+T(vec2(0,1))*2.0+T(vec2(1,1))
          + T(vec2(-1,0))*2.0+T(vec2(0,0))*4.0+T(vec2(1,0))*2.0
          + T(vec2(-1,-1))+T(vec2(0,-1))*2.0+T(vec2(1,-1));
          gl_FragColor=vec4(s/16.0,1.0); }`
    });

    this.comp = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null }, uBloom: { value: null },
        uTime:  { value: 0 },
        uFear:  { value: 0 },     // 0..1 proximity dread
        uRec:   { value: 0 },     // filming
        uGlitch:{ value: 0 },     // tape dropout
        uFade:  { value: 1 },     // to/from black
        uHurt:  { value: 0 },
        uExposure: { value: 1.25 },
        uRes:   { value: new THREE.Vector2() },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uScene, uBloom;
        uniform float uTime, uFear, uRec, uGlitch, uFade, uHurt, uExposure;
        uniform vec2 uRes;
        varying vec2 vUv;
        ${NOISE}
        ${ACES}

        void main(){
          vec2 uv = vUv;
          vec2 c  = uv - 0.5;
          float r2 = dot(c,c);

          // ---- tape dropout: whole scanlines slip sideways --------------
          float band = floor(uv.y * 90.0);
          float slip = (hash12(vec2(band, floor(uTime*13.0))) - 0.5);
          float slipOn = step(0.86 - uGlitch*0.55, hash12(vec2(band*0.37, floor(uTime*7.0))));
          uv.x += slip * slipOn * uGlitch * 0.055;

          // ---- lens ------------------------------------------------------
          uv += c * r2 * -0.055;
          float ab = (0.0009 + uFear*0.0055 + uHurt*0.011) * (0.3 + r2*3.0);
          vec2 dir = normalize(c + 1e-5);

          vec3 col;
          col.r = texture2D(uScene, uv + dir*ab).r;
          col.g = texture2D(uScene, uv).g;
          col.b = texture2D(uScene, uv - dir*ab).b;

          col += texture2D(uBloom, uv).rgb * 0.55;

          // ---- grade -----------------------------------------------------
          // ACES has a steep toe. A night scene sits right in it, so without
          // real exposure the whole island tone-maps down to near-black and
          // the game just looks broken.
          col *= uExposure;
          col = acesFilm(col);

          // crush toward cold; horror lives in the shadows, not the midtones
          col = pow(col, vec3(1.10, 1.06, 1.00));
          col += vec3(0.004,0.006,0.012);
          col = mix(vec3(dot(col, vec3(0.30,0.59,0.11))), col, 0.80);
          col *= mix(vec3(1.0), vec3(1.15,0.72,0.72), uHurt);

          // ---- vignette, tight ------------------------------------------
          float vig = smoothstep(1.05, 0.16, length(c)*1.5);
          col *= mix(1.0, vig, 0.66 + uFear*0.16);

          // ---- grain, always on -----------------------------------------
          float g = hash12(gl_FragCoord.xy + fract(uTime)*vec2(431.7, 719.3));
          col += (g - 0.5) * (0.055 + uRec*0.05 + uFear*0.045);

          // ---- recording chrome -----------------------------------------
          float scan = sin(vUv.y * uRes.y * 1.4) * 0.5 + 0.5;
          col *= 1.0 - scan * 0.045 * uRec;

          // ---- static bursts when it's close ----------------------------
          float st = hash12(gl_FragCoord.xy*0.7 + fract(uTime*3.1)*vec2(97.0,131.0));
          col = mix(col, vec3(st), uGlitch*0.30);

          col = linearToSRGB(max(col, 0.0));
          col *= (1.0 - uFade);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
  }

  setSize(w, h) {
    this.scene.setSize(w, h);
    let mw = w, mh = h;
    for (let i = 0; i < MIPS; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      this.down[i].setSize(mw, mh);
      this.up[i].setSize(mw, mh);
    }
    this.comp.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera) {
    const r = this.r;
    r.setRenderTarget(this.scene);
    r.clear();
    r.render(scene, camera);

    this.bright.uniforms.uTex.value = this.scene.texture;
    this.quad.render(r, this.bright, this.down[0]);
    for (let i = 1; i < MIPS; i++) {
      this.blur.uniforms.uTex.value = this.down[i - 1].texture;
      this.blur.uniforms.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
      this.quad.render(r, this.blur, this.down[i]);
    }
    this.blur.uniforms.uTex.value = this.down[MIPS - 1].texture;
    this.blur.uniforms.uTexel.value.set(1 / this.down[MIPS - 1].width, 1 / this.down[MIPS - 1].height);
    this.quad.render(r, this.blur, this.up[MIPS - 1]);
    for (let i = MIPS - 2; i >= 0; i--) {
      this.blur.uniforms.uTex.value = this.down[i].texture;
      this.blur.uniforms.uTexel.value.set(1 / this.down[i].width, 1 / this.down[i].height);
      this.quad.render(r, this.blur, this.up[i]);
      this.addMat.uniforms.uTex.value = this.up[i + 1].texture;
      this.addMat.uniforms.uTexel.value.set(1 / this.up[i + 1].width, 1 / this.up[i + 1].height);
      this.quad.render(r, this.addMat, this.up[i]);
    }

    this.comp.uniforms.uScene.value = this.scene.texture;
    this.comp.uniforms.uBloom.value = this.up[0].texture;
    this.quad.render(r, this.comp, null);
  }
}
