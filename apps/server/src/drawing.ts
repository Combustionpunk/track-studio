// What the server draws a track's plan with: the engine's shared plan renderer, so the PNG preview, the link-preview
// card and the web plan look the same. The preview hash (store.ts) is of this drawing.
import { planScene, planSvg, type RcTrack } from "@track-studio/engine";

export const PREVIEW_WIDTH = 1200;

export function drawPreview(doc: RcTrack): string {
  if (!doc.built) throw new Error("drawPreview: track has no built section (bake it first)");
  return planSvg(planScene(doc), { width: PREVIEW_WIDTH });
}
