// The class speeds behind the lap time estimates (#76): a layout that hasn't been raced in a class shows lap length ÷
// speed, marked "est.". Everyone can read them; track-admins edit them.
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorAlert, Skeleton } from "../components/states.js";
import { api, type ClassSpeed } from "../lib/api.js";
import { useApi } from "../lib/hooks.js";
import { MAX_SPEED, MIN_SPEED, parseSpeedRows } from "../lib/laps.js";
import { useSession } from "../lib/session.js";

type Row = { class: string; speed: string };

const toRows = (list: ClassSpeed[]): Row[] => list.map((c) => ({ class: c.class, speed: String(c.speed) }));

export function LapSpeeds() {
  const { me } = useSession();
  const res = useApi<{ classes: ClassSpeed[] }>("/api/class-speeds");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({});
  useEffect(() => {
    if (res.data && !rows) setRows(toRows(res.data.classes));
  }, [res.data, rows]);
  const shown = rows ?? (res.data ? toRows(res.data.classes) : null);

  const edit = (i: number, patch: Partial<Row>) => {
    setRows((shown ?? []).map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setState({});
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseSpeedRows(shown ?? []);
    if ("error" in parsed) return setState({ error: parsed.error });
    setState({ busy: true });
    try {
      const out = await api<{ classes: ClassSpeed[] }>("/api/class-speeds", { method: "PUT", json: parsed });
      setRows(toRows(out.classes));
      setState({ saved: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : "Couldn't save the speeds" });
    }
  };

  return (
    <div className="ts-page">
      <div className="ts-page-head">
        <div>
          <h1 className="ts-title">Lap speeds</h1>
          <p className="ts-page-head__sub">The typical speed of each class around a lap, for layouts with no race results yet.</p>
        </div>
      </div>
      <section className="ts-section ts-speeds">
        <p className="ts-help">
          A layout that hasn't been raced in a class shows an estimated lap time: its lap length divided by the class's speed, marked "est.". Once the forum has
          results from a meeting on it, the real typical lap replaces the estimate. The first class is the one the designer shows. Only track-admins can change these.
        </p>
        {res.error ? (
          <ErrorAlert title="Couldn't load the speeds." onRetry={res.reload}>
            {res.error.message}. Try again in a moment.
          </ErrorAlert>
        ) : !shown ? (
          <Skeleton className="ts-speeds__skeleton" />
        ) : me?.organiser ? (
          <form onSubmit={save} className="ts-speeds__form">
            <ol className="ts-speeds__rows">
              {shown.map((r, i) => (
                <li key={i} className="ts-speeds__row">
                  <input className="ts-input" aria-label={`Class ${i + 1} name`} placeholder="Class" maxLength={40} value={r.class} onChange={(e) => edit(i, { class: e.target.value })} />
                  <input
                    className="ts-input ts-speeds__speed"
                    type="number"
                    inputMode="decimal"
                    min={MIN_SPEED}
                    max={MAX_SPEED}
                    step={0.1}
                    aria-label={`${r.class.trim() || `Class ${i + 1}`} speed in metres per second`}
                    value={r.speed}
                    onChange={(e) => edit(i, { speed: e.target.value })}
                  />
                  <span className="ts-speeds__unit">m/s</span>
                  <button type="button" className="ts-btn ts-btn--quiet ts-btn--icon" onClick={() => (setRows(shown.filter((_, k) => k !== i)), setState({}))} title={`Remove ${r.class || "this class"}`}>
                    <Trash2 size={16} aria-hidden />
                    <span className="sr-only">Remove {r.class || "this class"}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="ts-speeds__actions">
              <button type="button" className="ts-btn" onClick={() => (setRows([...shown, { class: "", speed: "" }]), setState({}))}>
                <Plus size={16} aria-hidden />
                Add a class
              </button>
              <button type="submit" className="ts-btn ts-btn--primary" disabled={state.busy}>
                Save speeds
              </button>
            </div>
            <p className={state.error ? "ts-help ts-help--error" : "ts-help"} role="status">
              {state.error ?? (state.saved ? "Saved. Estimates use the new speeds now." : "")}
            </p>
          </form>
        ) : (
          <dl className="ts-speeds__list">
            {shown.map((r) => (
              <div key={r.class} className="ts-speeds__row">
                <dt>{r.class}</dt>
                <dd>{r.speed} m/s</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
