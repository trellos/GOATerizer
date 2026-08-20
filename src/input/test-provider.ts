/**
 * Deterministic guitar input for automated tests and the developer panel.
 *
 * This is **not** a fallback. Nothing in the normal UI can select it, and the
 * app refuses to score with it unless dev mode is explicitly on — a game that
 * quietly scored fake input while claiming to hear a guitar would be lying
 * about the only thing it does.
 *
 * It exists because judgment has to be testable without a microphone: the same
 * injected attack at the same beat must produce the same Perfect, every time.
 */

import {
  Emitter,
  type GuitarInputEvent,
  type GuitarInputProvider,
  type GuitarInputStatus,
  type Unsubscribe,
} from "./guitar-input.js";

/** One scripted event, queued to fire when the clock reaches `contextTime`. */
export type ScriptedInput =
  | { at: number; kind: "attack"; midi: number; confidence?: number; id?: string }
  | { at: number; kind: "retune"; id: string; midi: number }
  | { at: number; kind: "sustain"; id: string; midi: number; bendCents?: number }
  | { at: number; kind: "release"; id: string };

export class TestGuitarInputProvider implements GuitarInputProvider {
  readonly kind = "test" as const;

  readonly #events = new Emitter<GuitarInputEvent>();
  readonly #statusChanges = new Emitter<GuitarInputStatus>();
  #queue: ScriptedInput[] = [];
  #nextId = 1;
  #running = false;
  #status: GuitarInputStatus = {
    kind: "test",
    state: "idle",
    message: "Deterministic test input (dev only). No microphone is open.",
  };

  getStatus(): GuitarInputStatus {
    return this.#status;
  }

  onEvent(handler: (event: GuitarInputEvent) => void): Unsubscribe {
    return this.#events.on(handler);
  }

  onStatusChange(handler: (status: GuitarInputStatus) => void): Unsubscribe {
    return this.#statusChanges.on(handler);
  }

  async start(): Promise<void> {
    this.#running = true;
    this.#setStatus({
      state: "listening",
      message: "Deterministic test input is driving the game. This is NOT a guitar.",
    });
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#queue = [];
    this.#setStatus({ state: "idle", message: "Test input stopped." });
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.#events.clear();
    this.#statusChanges.clear();
  }

  /* ------------------------------------------------------------------ */
  /* Injection                                                           */
  /* ------------------------------------------------------------------ */

  /** Fires an attack immediately at the given audio-clock time. */
  attack(midi: number, contextTime: number, confidence = 0.95, id = this.#mintId()): string {
    this.#events.emit({
      type: "attack",
      id,
      midi,
      frequencyHz: 440 * 2 ** ((midi - 69) / 12),
      confidence,
      contextTime,
    });
    return id;
  }

  /** The recognizer changing its mind about a note it already announced. */
  retune(id: string, midi: number, contextTime: number, confidence = 0.95): void {
    this.#events.emit({
      type: "retune",
      id,
      midi,
      frequencyHz: 440 * 2 ** ((midi - 69) / 12),
      confidence,
      contextTime,
    });
  }

  /** A continuous update on a sounding note, optionally bending. */
  sustain(id: string, midi: number, contextTime: number, bendCents = 0): void {
    this.#events.emit({
      type: "sustain",
      id,
      midi,
      frequencyHz: 440 * 2 ** ((midi - 69 + bendCents / 100) / 12),
      bendCents,
      contextTime,
    });
  }

  release(id: string, contextTime: number): void {
    this.#events.emit({ type: "release", id, contextTime });
  }

  /* ------------------------------------------------------------------ */
  /* Scripting                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Queues events to fire when {@link pump} reaches their time.
   *
   * The app's frame loop pumps the provider while it is active, so a script
   * plays against the real audio clock in the browser and against a fake one in
   * a test — the same code path either way.
   */
  schedule(events: readonly ScriptedInput[]): void {
    this.#queue = [...this.#queue, ...events].sort((a, b) => a.at - b.at);
  }

  clearSchedule(): void {
    this.#queue = [];
  }

  get pending(): number {
    return this.#queue.length;
  }

  /** Emits every queued event at or before `contextTime`. */
  pump(contextTime: number): void {
    if (!this.#running) return;
    while (this.#queue.length > 0 && (this.#queue[0]?.at ?? Infinity) <= contextTime) {
      const event = this.#queue.shift();
      if (!event) break;
      switch (event.kind) {
        case "attack":
          this.attack(event.midi, event.at, event.confidence ?? 0.95, event.id ?? this.#mintId());
          break;
        case "retune":
          this.retune(event.id, event.midi, event.at);
          break;
        case "sustain":
          this.sustain(event.id, event.midi, event.at, event.bendCents ?? 0);
          break;
        case "release":
          this.release(event.id, event.at);
          break;
      }
    }
  }

  #mintId(): string {
    return `test-${this.#nextId++}`;
  }

  #setStatus(patch: Partial<GuitarInputStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#statusChanges.emit(this.#status);
  }
}
