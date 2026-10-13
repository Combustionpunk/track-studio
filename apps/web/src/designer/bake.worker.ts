// Runs the full engine bake off the main thread, so dragging stays smooth.
import { bakeBuilt, type Built, type RcTrack } from "@track-studio/engine";

export interface BakeRequest {
  seq: number;
  doc: RcTrack;
}
export interface BakeResponse {
  seq: number;
  built?: Built;
  error?: string;
  ms: number;
}

self.onmessage = (e: MessageEvent<BakeRequest>) => {
  const t0 = performance.now();
  try {
    const built = bakeBuilt(e.data.doc);
    (self as unknown as Worker).postMessage({ seq: e.data.seq, built, ms: performance.now() - t0 } satisfies BakeResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ seq: e.data.seq, error: (err as Error).message, ms: performance.now() - t0 } satisfies BakeResponse);
  }
};
