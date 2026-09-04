/**
 * The soft-clipping curve, shared by the master bus and the drum bus.
 *
 * Linear below the knee, bending smoothly above it, approaching but never
 * reaching full scale. Two properties make it the right shape in both places,
 * and they are the reason it is one function rather than two similar loops:
 *
 *   - **Nothing below the knee is touched at all.** The curve is continuous in
 *     value *and* in slope there, so ordinary playing passes through unchanged
 *     and only a peak that would have clipped is rounded.
 *   - **It never has gain above one.** A normalised `tanh` — scaled so full
 *     scale maps to full scale — gives everything below full scale a gain of up
 *     to 1.4, which is a distortion pedal rather than a limiter. That trap is
 *     documented in `audio-engine.ts` because it was fallen into there first.
 *
 * On the master it is protection: the mix is summed with none. On the drum bus
 * it is deliberately *driven into*, which is a different use of the same shape —
 * see `drum-voices.ts`, where the drive is what raises the kit's average level
 * without raising its peak.
 */

/**
 * A `WaveShaperNode` curve that is the identity below `knee` and compresses
 * above it.
 *
 * @param knee Where the bend starts, in 0..1. Lower knees bend more of the
 *   signal, so a bus meant to be driven uses a lower one than a bus meant only
 *   to be protected.
 * @param samples Curve resolution. The default is fine for both uses; a
 *   `WaveShaperNode` interpolates between the points.
 */
export function softClipCurve(knee: number, samples = 2048): Float32Array<ArrayBuffer> {
  // Explicitly backed by an `ArrayBuffer` rather than the `ArrayBufferLike` a
  // bare `Float32Array` widens to: `WaveShaperNode.curve` will not take one
  // that might be shared.
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  const limit = Math.min(0.999, Math.max(0, knee));
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    curve[i] =
      magnitude <= limit
        ? x
        : Math.sign(x) * (limit + (1 - limit) * Math.tanh((magnitude - limit) / (1 - limit)));
  }
  return curve;
}
