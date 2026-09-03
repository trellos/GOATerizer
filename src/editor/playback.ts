/**
 * Hearing what is on the editor's timeline.
 *
 * The same discipline as the backing players (`AGENTS.md` §5): the transport is
 * the clock, a timer only decides when to *look*, and every note is handed to
 * the audio clock at a time computed from the beat rather than played when a
 * callback happens to run. So the loop stays in time through a slow frame, and
 * the playhead the editor draws is the transport's position rather than an
 * animation.
 *
 * The kit is the game's own: `drumPatternForAttempt` picks the beat from the
 * level's difficulty and the feel of its own notes, so a phrase of sixteenths
 * gets the sixteenth variant here exactly as it would in a run.
 *
 * The guitar is the dev pluck voice, not a sampled guitar and not Tuninator's
 * business at all — this is playback, and nothing here ever reaches the
 * recognizer or is judged.
 */

import { AudioEngine } from "../audio/audio-engine.js";
import { BACKBEAT_PATTERN, drumPatternForAttempt } from "../audio/drum-pattern.js";
import { DrumPlayer } from "../audio/drum-player.js";
import { forEachLoopEvent } from "../audio/loop-scheduling.js";
import { Transport } from "../audio/transport.js";
import { PluckVoicePool } from "../dev/pluck-voices.js";
import { AUTOPLAY_PLUCK_GAP_SECONDS, AUTOPLAY_PLUCK_MIN_SOUNDING_SECONDS } from "../config/tuning.js";
import { parseDegreeToken, resolveDegree } from "../music/degrees.js";
import { degreeToMidi, type RunKey } from "../music/keys.js";
import { DURATION_BEATS, type PromptEvent } from "../scenario/types.js";
import { PHRASE_TICKS, TICKS_PER_BEAT, TICKS_PER_MEASURE, type EditorNote } from "./grid.js";
import { tokenForLane, type LaneVocabulary } from "./vocabulary.js";

/**
 * The key the editor auditions in.
 *
 * A run rolls its key at the start and every scenario is authored in
 * transposable degrees, so the editor's pitch is a *presentation* choice with no
 * effect on what is saved. C major, because a scale degree and its concrete
 * pitch line up there and there is nothing to explain.
 */
export const EDITOR_KEY: RunKey = { tonic: 0, mode: "major" };

const TICK_MS = 25;
const LOOKAHEAD_S = 0.15;

/**
 * What the loop plays.
 *
 * `notes` are the ones that are actually heard: the editor tiles its loop
 * before handing them over, so what plays is what would be saved.
 */
export type Program = {
  readonly notes: readonly EditorNote[];
  readonly vocabulary: LaneVocabulary;
  readonly difficulty: number;
};

/** Cheap identity for a program, so an unchanged one costs nothing. */
function programSignature(program: Program): string {
  return `${program.difficulty}|${program.notes
    .map((note) => `${note.startTick}.${note.lane}.${note.duration}`)
    .join(",")}`;
}

/**
 * The notes as a prompt, for the one thing that reads one: `subdivisionsOf`,
 * which the kit picks its rhythm variant from. It reads positions and written
 * lengths and nothing else, so a degree it is never given is null rather than
 * resolved — this is a description of the *rhythm*, not of the music.
 */
function asPrompt(notes: readonly EditorNote[]): PromptEvent[] {
  return notes.map((note, index) => ({
    index,
    type: "note",
    duration: note.duration,
    durationBeats: DURATION_BEATS[note.duration],
    startBeat: note.startTick / TICKS_PER_BEAT,
    measureIndex: Math.floor(note.startTick / TICKS_PER_MEASURE),
    beatWithinMeasure: (note.startTick % TICKS_PER_MEASURE) / TICKS_PER_BEAT,
    degree: null,
  }));
}

export class EditorPlayback {
  readonly #audio: AudioEngine;
  readonly #transport: Transport;
  #drums: DrumPlayer | null = null;
  #plucks: PluckVoicePool | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #playing = false;
  /** Absolute transport beat the loop's beat 0 sits on. */
  #originBeat = 0;
  #scheduledThroughBeat = 0;
  #events: readonly { startBeat: number; midi: number; durationBeats: number }[] = [];
  /**
   * What the loop is currently playing, as a string.
   *
   * `setProgram` is called on every repaint — which is every pointer move while
   * a marquee is open — and re-scheduling voices sixty times a second to arrive
   * at the same notes is churn nobody can hear. This is what makes "the loop
   * follows the edit" cost nothing when there was no edit.
   */
  #signature = "";
  /** Which beat the kit is playing. See `game-app.ts` `#refreshDrumBeat`. */
  #patternId = "";

  constructor(audio: AudioEngine, transport: Transport) {
    this.#audio = audio;
    this.#transport = transport;
  }

  get playing(): boolean {
    return this.#playing;
  }

  /**
   * Where the playhead is, in ticks from the start of the phrase, or null when
   * nothing is playing.
   */
  get playheadTick(): number | null {
    if (!this.#playing || !this.#transport.running) return null;
    const into = this.#transport.beat - this.#originBeat;
    const phraseBeats = PHRASE_TICKS / TICKS_PER_BEAT;
    const wrapped = ((into % phraseBeats) + phraseBeats) % phraseBeats;
    return wrapped * TICKS_PER_BEAT;
  }

  /**
   * Starts the loop. Must be called from a user gesture — it unlocks audio.
   */
  async play(program: Program & { bpm: number }): Promise<boolean> {
    const running = await this.#audio.unlock();
    const context = this.#audio.context;
    const master = this.#audio.master;
    if (!running || !context || !master) return false;

    if (!this.#transport.running) this.#transport.start(program.bpm);
    else this.#transport.setBpm(program.bpm);

    this.#drums ??= new DrumPlayer(context, this.#transport, master);
    this.#plucks ??= this.#buildPlucks(context, master);
    this.#drums.start();

    // Start on the next bar line, so the loop and the kit agree about beat 1.
    this.#originBeat = this.#transport.nextMeasureBoundary();
    this.#scheduledThroughBeat = this.#originBeat;
    this.#playing = true;
    this.#setProgram(program);
    this.#timer ??= setInterval(() => this.#tick(), TICK_MS);
    return true;
  }

  /**
   * Changes what the running loop plays, without stopping it.
   *
   * Editing is the point of the editor, so the loop has to follow the edit —
   * moving a note, deleting one, switching difficulty. Everything already
   * *sounding* is left alone and everything merely queued is dropped, so a
   * change lands within the scheduler's lookahead (about a sixth of a second)
   * without a click.
   *
   * Silent when nothing is playing, apart from remembering the program: a
   * paused editor has nothing to re-schedule, and `play` reads it back.
   */
  setProgram(program: Program): void {
    this.#setProgram(program);
  }

  #setProgram(program: Program): void {
    const signature = programSignature(program);
    if (signature === this.#signature) return;
    this.#signature = signature;

    this.#events = program.notes.map((note) => {
      const ref = resolveDegree(
        parseDegreeToken(tokenForLane(program.vocabulary, note.lane)),
        EDITOR_KEY.mode
      );
      return {
        startBeat: note.startTick / TICKS_PER_BEAT,
        durationBeats: DURATION_BEATS[note.duration],
        midi: degreeToMidi(ref, EDITOR_KEY),
      };
    });

    // The kit states the feel of the notes on the timeline, exactly as it
    // states the feel of an attempt's phrase in a run: `subdivisionsOf` reads
    // positions and written lengths, both of which these notes have, so the
    // beat follows an edit without waiting for the file to be valid.
    const pattern =
      program.notes.length > 0
        ? drumPatternForAttempt(program.difficulty, asPrompt(program.notes))
        : BACKBEAT_PATTERN;
    if (pattern.id !== this.#patternId) {
      this.#patternId = pattern.id;
      this.#drums?.setPattern(pattern);
    }

    if (!this.#playing) return;
    const context = this.#audio.context;
    if (context) this.#plucks?.dropUnstarted(context.currentTime);
    // Re-schedule from now — but never from before the loop's own beat 0. `play`
    // sets the origin to the *next* bar line and then programs, so an unclamped
    // "now" here is a negative loop position, and the scheduler would answer it
    // with the tail of a pass that has not happened: a burst of notes in the
    // past, played the instant Play is pressed.
    this.#scheduledThroughBeat = Math.max(this.#originBeat, this.#transport.beat);
  }

  pause(): void {
    this.#playing = false;
    // So the next `play` re-schedules rather than recognising its own program.
    this.#signature = "";
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#drums?.stop();
    if (this.#audio.context) this.#plucks?.cancelFrom(this.#audio.context.currentTime);
  }

  setBpm(bpm: number): void {
    if (!this.#transport.running) return;
    this.#transport.setBpm(bpm);
    this.#drums?.retime();
    // The origin is a beat, and the beat survives a tempo change (`Transport`),
    // so the loop keeps its phase and only its speed changes.
  }

  dispose(): void {
    this.pause();
    this.#drums?.dispose();
    this.#plucks?.dispose();
    this.#drums = null;
    this.#plucks = null;
  }

  /**
   * Plays one note now, so placing or moving a bar is audible.
   *
   * Silent until the editor's audio has been unlocked by something the author
   * clicked — a page cannot make a sound before then, and it is not this
   * function's job to ask.
   */
  audition(note: EditorNote, vocabulary: LaneVocabulary): void {
    const context = this.#audio.context;
    const master = this.#audio.master;
    if (!context || !master) return;
    this.#plucks ??= this.#buildPlucks(context, master);
    const ref = resolveDegree(
      parseDegreeToken(tokenForLane(vocabulary, note.lane)),
      EDITOR_KEY.mode
    );
    this.#plucks.pluck(degreeToMidi(ref, EDITOR_KEY), context.currentTime + 0.01, 0.25);
  }

  /**
   * The editor's guitar: the harmonic pluck, not the recognizer's sine.
   *
   * Nothing here is ever detected — the editor has no judge — so the only
   * listener is a person, competing with a drum kit. See `dev/pluck-voices.ts`.
   */
  #buildPlucks(context: AudioContext, master: AudioNode): PluckVoicePool {
    return new PluckVoicePool(context, master, "pluck");
  }

  #tick(): void {
    if (!this.#playing || !this.#transport.running) return;
    const plucks = this.#plucks;
    if (!plucks) return;

    const horizon = this.#transport.beat + LOOKAHEAD_S / this.#transport.secondsPerBeat;
    const phraseBeats = PHRASE_TICKS / TICKS_PER_BEAT;
    const from = this.#scheduledThroughBeat - this.#originBeat;
    const to = horizon - this.#originBeat;
    if (to <= from) return;

    forEachLoopEvent(this.#events, phraseBeats, from, to, (event, atLoopBeat) => {
      const at = this.#transport.contextTimeAt(this.#originBeat + atLoopBeat);
      const sounding = Math.max(
        AUTOPLAY_PLUCK_MIN_SOUNDING_SECONDS,
        event.durationBeats * this.#transport.secondsPerBeat - AUTOPLAY_PLUCK_GAP_SECONDS
      );
      plucks.pluck(event.midi, at, sounding);
    });
    this.#scheduledThroughBeat = horizon;
  }
}
