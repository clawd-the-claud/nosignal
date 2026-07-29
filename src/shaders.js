// ============================================================================
//  NO SIGNAL — shared GLSL
//  One lighting model for every surface on the island: a dim moon you can
//  barely see by, thick fog, and the phone torch — which is the only thing
//  that really lights anything, and the only thing that gives you away.
// ============================================================================

export const NOISE = /* glsl */`
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float hash13(vec3 p3){
  p3 = fract(p3*0.1031);
  p3 += dot(p3, p3.zyx+31.32);
  return fract((p3.x+p3.y)*p3.z);
}
float vnoise2(vec2 x){
  vec2 i = floor(x), f = fract(x);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float vnoise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x),
                 mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x),
                 mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
const mat2 M2 = mat2(0.80,0.60,-0.60,0.80);
float fbm2(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise2(p); p=M2*p*2.03; a*=0.5; } return s; }
float fbm2s(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<3;i++){ s+=a*vnoise2(p); p=M2*p*2.07; a*=0.5; } return s; }
float fbm3(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise3(p); p*=2.02; a*=0.5; } return s; }
`;

/* -------------------------------------------------------------------------
   LIGHTING — declares its own uniforms. Include once per material.
   ------------------------------------------------------------------------- */
export const LIGHT = /* glsl */`
uniform vec3  uTorchPos;
uniform vec3  uTorchDir;
uniform float uTorchOn;       // 0..1, also carries the flicker
uniform float uTorchRange;
uniform float uTorchCos;      // cosine of the cone half-angle
uniform vec3  uMoonDir;
uniform vec3  uAmbient;
uniform vec3  uFogCol;
uniform float uFogDen;
uniform float uWrong;         // 0..1 — how far the island has turned

vec3 islandLight(vec3 albedo, vec3 N, vec3 P, float gloss){
  // --- moon: barely there, cold, and mostly a silhouette-maker -----------
  float ndl = max(dot(N, uMoonDir), 0.0);
  vec3 col = albedo * (uAmbient + vec3(0.055,0.075,0.115) * ndl);

  // --- torch: a hard cone. This is the whole game's readability ----------
  vec3  toL = uTorchPos - P;
  float d   = length(toL);
  vec3  L   = toL / max(d, 0.001);

  float cone = dot(-L, uTorchDir);

  // Two cones. The hot one is the beam you aim; the wide, dim one is spill,
  // and without it the vertical FOV is three times the beam angle and you
  // cannot see your own feet.
  float hot   = smoothstep(uTorchCos, uTorchCos + 0.10, cone);
  float spill = smoothstep(0.10, 0.72, cone);
  float spot  = hot + spill * 0.34;

  float att  = 1.0 / (1.0 + d*d*0.009);
  att *= smoothstep(uTorchRange, uTorchRange*0.4, d);

  float lam = max(dot(N, L), 0.0);
  vec3 torch = vec3(1.00, 0.94, 0.82) * spot * att * uTorchOn;

  col += albedo * torch * (lam * 5.40 + 0.45);

  // tight specular so wet rock and glass catch the beam
  vec3 V = normalize(cameraPosition - P);
  vec3 H = normalize(L + V);
  col += torch * pow(max(dot(N,H),0.0), 34.0) * gloss * 0.7;

  return col;
}

vec3 islandFog(vec3 col, float dist, vec3 P){
  float f = 1.0 - exp(-dist * uFogDen);

  // the fog itself picks up a little of the torch, so the beam is visible
  float beam = max(dot(normalize(P - cameraPosition), uTorchDir), 0.0);
  vec3 fogc = uFogCol + vec3(0.10,0.093,0.080) * pow(beam, 22.0) * uTorchOn * 0.85;

  // when the island turns, the fog goes sour
  fogc = mix(fogc, vec3(0.055,0.020,0.030), uWrong*0.6);

  return mix(col, fogc, clamp(f, 0.0, 1.0));
}
`;

/* -------------------------------------------------------------------------
   SKY — a low, sick night sky. Almost no stars: the overcast is the point.
   ------------------------------------------------------------------------- */
export const SKY_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3  uMoonDir;
uniform vec3  uFogCol;
uniform float uWrong;
varying vec3 vDir;
${NOISE}
void main(){
  vec3 rd = normalize(vDir);
  float h = rd.y;

  vec3 low  = uFogCol * 1.05;
  vec3 high = vec3(0.012,0.016,0.030);
  vec3 col = mix(low, high, smoothstep(-0.05, 0.62, h));

  // heavy cloud deck, slowly churning
  float cl = fbm2(rd.xz / max(abs(h)+0.16, 0.16) * 1.1 + vec2(uTime*0.006, uTime*0.003));
  col += vec3(0.030,0.034,0.046) * smoothstep(0.35,0.85,cl) * smoothstep(0.0,0.35,h);

  // a bruise of moonlight behind the overcast
  float md = max(dot(rd, uMoonDir), 0.0);
  col += vec3(0.16,0.18,0.24) * pow(md, 28.0) * 0.55;
  col += vec3(0.05,0.06,0.09) * pow(md, 5.0) * 0.30;

  // a few stars punch through, fewer as things go wrong
  float st = step(0.9975, hash13(floor(rd*260.0)));
  col += vec3(0.55,0.60,0.72) * st * smoothstep(0.1,0.5,h) * (1.0 - uWrong);

  col = mix(col, vec3(0.075,0.014,0.022), uWrong*0.55);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const ACES = /* glsl */`
vec3 acesFilm(vec3 x){
  const mat3 IN = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
  const mat3 OUT= mat3( 1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
  vec3 v = IN*x;
  vec3 a = v*(v+0.0245786) - 0.000090537;
  vec3 b = v*(0.983729*v + 0.4329510) + 0.238081;
  return clamp(OUT*(a/b), 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c){
  return mix(c*12.92, 1.055*pow(max(c,vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;

/** Uniform block every world material shares — one object, passed by reference. */
export function lightUniforms(THREE) {
  return {
    uTime:       { value: 0 },
    uTorchPos:   { value: new THREE.Vector3() },
    uTorchDir:   { value: new THREE.Vector3(0, 0, -1) },
    uTorchOn:    { value: 0 },
    uTorchRange: { value: 40 },
    uTorchCos:   { value: Math.cos(0.50) },
    uMoonDir:    { value: new THREE.Vector3(0.30, 0.34, -0.89).normalize() },
    uAmbient:    { value: new THREE.Color(0.026, 0.032, 0.048) },
    uFogCol:     { value: new THREE.Color(0.030, 0.036, 0.050) },
    uFogDen:     { value: 0.026 },
    uWrong:      { value: 0 },
  };
}
