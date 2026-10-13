// Bakes the latest design in a worker. Only one bake runs at a time; changes made meanwhile are coalesced, so the
// worker always works on the newest design and never falls behind.
import type { Built, RcTrack } from "@track-studio/engine";
import { useEffect, useRef, useState } from "react";
import type { BakeRequest, BakeResponse } from "./bake.worker.js";

export interface BakeState {
  built: Built | null;
  /** the design has changed since `built` was made */
  pending: boolean;
  error: string | null;
  ms: number;
}

export function useBake(doc: RcTrack | null): BakeState {
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const latest = useRef<{ seq: number; doc: RcTrack } | null>(null);
  const seq = useRef(0);
  const [state, setState] = useState<BakeState>({ built: null, pending: true, error: null, ms: 0 });

  useEffect(() => {
    const w = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent<BakeResponse>) => {
      busy.current = false;
      const next = latest.current;
      const stale = !!next && next.seq !== e.data.seq;
      setState((s) => ({ built: e.data.built ?? s.built, pending: stale, error: e.data.error ?? null, ms: e.data.ms }));
      if (stale && next) send(next);
    };
    if (latest.current) send(latest.current);
    return () => {
      w.terminate();
      worker.current = null;
      busy.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(req: BakeRequest) {
    if (!worker.current) return;
    busy.current = true;
    worker.current.postMessage(req);
  }

  useEffect(() => {
    if (!doc) return;
    const req = { seq: ++seq.current, doc };
    latest.current = req;
    setState((s) => (s.pending ? s : { ...s, pending: true }));
    if (!busy.current) send(req);
  }, [doc]);

  return state;
}
