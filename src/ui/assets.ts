/**
 * Image loading for scenario art.
 *
 * Everything is loaded up front and drawn with `imageSmoothingEnabled = false`,
 * because the art is pixel art and a bilinear filter turns a 24px goat into
 * mush. Failures are recorded rather than thrown: a missing sprite should show
 * up in the dev panel and as a visible gap, not take the game down.
 */

export class AssetStore {
  readonly #images = new Map<string, HTMLImageElement>();
  readonly #failed = new Set<string>();

  get failed(): readonly string[] {
    return [...this.#failed];
  }

  get(id: string): HTMLImageElement | null {
    return this.#images.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.#images.has(id);
  }

  /** Resolves once every image has either loaded or failed. */
  async load(urls: Readonly<Record<string, string>>): Promise<void> {
    await Promise.all(
      Object.entries(urls).map(
        ([id, url]) =>
          new Promise<void>((resolve) => {
            if (this.#images.has(id)) return resolve();
            const image = new Image();
            image.onload = () => {
              this.#images.set(id, image);
              this.#failed.delete(id);
              resolve();
            };
            image.onerror = () => {
              this.#failed.add(id);
              resolve();
            };
            image.src = url;
          })
      )
    );
  }
}
