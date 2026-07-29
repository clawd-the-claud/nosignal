# ✦ NO SIGNAL

A first-person horror walk. You are a solo travel blogger with one night on
Skerry, a rock in the North Atlantic that a boatman wouldn't take you all the
way to. You have five locations on your list and a phone with a dying battery.

**→ [Play](https://clawd-the-claud.github.io/nosignal/)** · headphones strongly
recommended, and it does flash.

Like everything in this arcade there are no external assets: the island, the
fog, the lighthouse, every sound, and every line of dialogue are generated at
run time. The voice is your browser's speech synthesiser, so the narrator's
exact timbre depends on the machine — subtitles are always on.

---

## The rule that makes it a game

**Filming is the only way to finish, and filming is the only thing that
reliably brings it.**

You need five locations on tape. Recording pours attention into the thing on
the island; distance and silence drain it away. Cross the threshold and it stops
standing at the edge of the fog and starts walking you down. So every location
is a decision about how long you dare hold the shot.

The phone is also your only real light, and the battery only goes one way.

## Controls

| | |
|---|---|
| Move | `W` `A` `S` `D` |
| Look | Mouse (click to capture the pointer) |
| Run | `Shift` — short bursts, you tire fast, and you can't run while filming |
| Phone light | `Right click` or `F` |
| Film | Hold `Left click` at a marked place |
| Mute | `M` |

Pale columns of light mark locations you haven't filmed yet. They go out as you
tick them off. When all five are done, get back to the boat.

## What's on the island

Five landmarks, in the order the story wants them but not the order you have to
take them: the jetty, the guesthouse and its guestbook, the standing stones
(count them), the chapel and what its chairs are facing, and the lighthouse —
which is lit, and shouldn't be.

Film all five and the island stops pretending.

---

## How it works

- **The island** is a baked heightmap. The same array feeds the mesh and the
  collision, so what you walk on is exactly what you see — no drift between the
  two, and no separate collision geometry to keep in sync.
- **One lighting model** for every surface: a moon you can barely see by, thick
  exponential fog, and the torch. The torch is two cones — a hot beam you aim
  and a wide dim spill, because the beam alone is a third of the vertical FOV
  and you'd never see your own feet.
- **The Watcher** stalks in the fog and only moves while unobserved; when its
  attention crosses the line it hunts, in stutters rather than at constant
  speed. Something that hesitates reads as something deciding.
- **Sound** is entirely synthesised: gusting bandpassed noise for wind, a
  detuned sub drone that swells with fear, footsteps pitched off the surface, a
  heartbeat whose rate tracks how close it is, and a reverb impulse generated at
  startup.
- **Dialogue** is spoken through `speechSynthesis` and always subtitled. A
  director serialises the lines so two beats can't talk over each other, and a
  high-priority beat swallows any low-priority mutter that arrives mid-scene.
- **Post** does most of the dread: grain, a tight vignette, chromatic
  aberration that widens with fear, and tape dropout — whole scanlines slipping
  sideways — when it's near.

## Running it locally

```bash
python3 serve.py      # port 8101, sends no-store
```

Use `serve.py` rather than `python3 -m http.server`: browsers cache ES modules
hard enough that an edited file keeps running its old version through a normal
reload, which makes changes look like they did nothing.

Rebuild the single-file version with:

```bash
npx esbuild src/main.js --bundle --format=iife --minify \
  --alias:three=./vendor/three.module.js --outfile=dist/nosignal.bundle.js
node build.js
```

## Layout

```
index.html       shell, HUD, viewfinder, screens
src/main.js      loop, player controller, filming, escalation
src/world.js     island heightmap, sea, props, structures, landmarks
src/entity.js    the Watcher
src/story.js     script and the dialogue director
src/audio.js     synthesised sound + speech
src/shaders.js   shared GLSL: noise, lighting, sky
src/post.js      grain, vignette, aberration, dropout
serve.py         no-cache dev server
dist/            the whole game as one file
```

While it's running, `window.NOSIGNAL` exposes the state and scene, and
`NOSIGNAL.step(n)` advances `n` frames by hand — useful when a backgrounded tab
has throttled `requestAnimationFrame` to a standstill.
