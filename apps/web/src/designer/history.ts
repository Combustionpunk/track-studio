// Undo/redo with whole-document snapshots. Changes in the same group merge into one step: a whole drag, or a burst
// of wheel / typing changes to the same thing within MERGE_MS.
import { useCallback, useReducer } from "react";

export const MERGE_MS = 800;
export const MAX_STEPS = 200;

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  group: string | null;
  at: number;
}

type Action<T> =
  | { type: "set"; next: T; group?: string; now: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: T };

export function historyReducer<T>(s: HistoryState<T>, a: Action<T>): HistoryState<T> {
  switch (a.type) {
    case "set": {
      if (a.next === s.present) return s;
      const merge = a.group !== undefined && a.group === s.group && (a.group.startsWith("drag:") || a.now - s.at < MERGE_MS);
      if (merge) return { ...s, present: a.next, at: a.now };
      return { past: [...s.past, s.present].slice(-MAX_STEPS), present: a.next, future: [], group: a.group ?? null, at: a.now };
    }
    case "undo":
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], group: null, at: 0 };
    case "redo":
      if (!s.future.length) return s;
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), group: null, at: 0 };
    case "reset":
      return { past: [], present: a.doc, future: [], group: null, at: 0 };
  }
}

export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(historyReducer<T>, { past: [], present: initial, future: [], group: null, at: 0 });
  const set = useCallback((next: T, group?: string) => dispatch({ type: "set", next, group, now: Date.now() }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback((doc: T) => dispatch({ type: "reset", doc }), []);
  return { present: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
