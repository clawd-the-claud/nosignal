// ============================================================================
//  NO SIGNAL — script and director
//  Lines are spoken live and subtitled. The director serialises them so two
//  beats can never talk over each other, and drops anything low-priority that
//  arrives while something important is being said.
// ============================================================================

const ME = 'me', THEM = 'them';

export const SCRIPT = {
  intro: [
    { t: "Okay. We're rolling. Day one on Skerry.", w: ME },
    { t: "Boat guy wouldn't come past the rocks. He's back at dawn. Allegedly.", w: ME },
    { t: "Five places on my list. Let's film them before I lose what's left of the light.", w: ME },
    { t: "Hold left click on a marked spot to film it. Right click for my phone light.", w: ME },
  ],

  'film:jetty': [
    { t: "Right. The jetty. Sixty years old, apparently, and nobody's repaired it since.", w: ME },
    { t: "Boat's gone. That's... that's fine. That's the plan.", w: ME },
  ],

  'film:guesthouse': [
    { t: "The old guesthouse. Door's already open.", w: ME },
    { t: "There's a guestbook on the desk. Names going back years.", w: ME },
    { t: "Huh. They all wrote the same last line. Every single one.", w: ME },
    { t: "\"The light is on.\"", w: ME },
  ],

  'film:stones': [
    { t: "The standing stones. The guidebook says there are seven.", w: ME },
    { t: "I'm counting nine.", w: ME },
    { t: "...I counted seven walking up here. I know I did.", w: ME },
  ],

  'film:chapel': [
    { t: "Chapel. No cross. No altar. Just chairs.", w: ME },
    { t: "Every chair is facing the window. Not the front — the window.", w: ME },
    { t: "They're all facing the lighthouse.", w: ME },
  ],

  'film:lighthouse': [
    { t: "The lighthouse. And the lamp is lit.", w: ME },
    { t: "Someone has to be keeping it lit. Someone has to be up there.", w: ME },
    { t: "Hello? I'm — I'm a guest. I'm just filming.", w: ME },
    { t: "You are filming.", w: THEM },
  ],

  firstSighting: [
    { t: "There's someone on the ridge.", w: ME },
    { t: "Hello? Hey! I can see you!", w: ME },
    { t: "...they didn't move. They didn't move at all.", w: ME },
  ],

  cameraWarning: [
    { t: "Every time I hit record, the static gets worse.", w: ME },
    { t: "I think it hears the camera.", w: ME },
  ],

  hunted: [
    { t: "It's coming. It's coming — go, go, go!", w: ME },
    { t: "Stop filming. Stop filming!", w: ME },
  ],

  escaped: [
    { t: "Okay. Okay. I think — I think I lost it.", w: ME },
    { t: "Keep it together. Three more. You can do three more.", w: ME },
  ],

  reveal: [
    { t: "Wait. There's people in the water.", w: ME },
    { t: "They're standing in the water. All along the shore. Facing the lighthouse.", w: ME },
    { t: "They're all holding cameras.", w: ME },
    { t: "They're all holding my camera.", w: ME },
    { t: "Welcome back.", w: THEM },
    { t: "Get to the boat. Get to the boat get to the boat—", w: ME },
  ],

  boatClose: [
    { t: "There it is. There's the boat. Come on—", w: ME },
  ],

  win: [
    { t: "I'm on. I'm on, go, GO—", w: ME },
    { t: "...", w: ME },
    { t: "Right. So. That's the Skerry video. Like and subscribe, I suppose.", w: ME },
    { t: "I'll see you on the next one.", w: THEM },
  ],

  ambient: [
    { t: "It's so quiet. There aren't even birds.", w: ME },
    { t: "My battery's draining way faster than it should be.", w: ME },
    { t: "I keep thinking I hear the boat.", w: ME },
    { t: "The fog's getting worse.", w: ME },
    { t: "Did you hear that? Tell me you heard that.", w: ME },
    { t: "There's no signal out here. Obviously. No signal anywhere.", w: ME },
  ],

  whispers: [
    { t: "Film it.", w: THEM },
    { t: "Look at me.", w: THEM },
    { t: "You already know how this ends.", w: THEM },
    { t: "Stay.", w: THEM },
    { t: "You wrote in the book.", w: THEM },
  ],
};

export class Director {
  constructor(sound) {
    this.sound = sound;
    this.queue = [];
    this.busy = false;
    this.priority = 0;
    this.fired = new Set();
    this.onBeat = () => {};
  }

  /**
   * @param prio higher wins. A running high-priority beat swallows anything
   *             lower that arrives while it plays, so a stray ambient mutter
   *             can never step on the reveal.
   */
  play(beat, prio = 1, once = false) {
    if (once) {
      if (this.fired.has(beat)) return;
      this.fired.add(beat);
    }
    const lines = SCRIPT[beat];
    if (!lines) return;
    if (this.busy && prio < this.priority) return;
    if (this.busy && prio > this.priority) { this.queue.length = 0; this.sound.shutUp(); }

    this.priority = prio;
    for (const l of lines) this.queue.push(l);
    this.onBeat(beat);
    if (!this.busy) this._next();
  }

  /** One random line from a pool, only if nothing else is talking. */
  mutter(pool, prio = 0) {
    if (this.busy) return;
    const lines = SCRIPT[pool];
    if (!lines || !lines.length) return;
    const l = lines[Math.floor(Math.random() * lines.length)];
    this.priority = prio;
    this.queue.push(l);
    this._next();
  }

  _next() {
    const l = this.queue.shift();
    if (!l) { this.busy = false; this.priority = 0; return; }
    this.busy = true;
    this.sound.say(l.t, l.w, {
      onEnd: () => setTimeout(() => this._next(), l.w === 'them' ? 700 : 260),
    });
  }

  clear() {
    this.queue.length = 0;
    this.busy = false;
    this.priority = 0;
    this.sound.shutUp();
  }
}
