// The designer's bar (#120): back, the name, the venue and area, the status, Quick's steps, the mode, undo / redo,
// Reverse direction, the save state, Save and Submit (with why it waits), and the save pop-over; and the messages under
// it. On a tablet the bar is one row at 1024 px: no venue, no undo / redo / reverse (the dock has them), the short save
// state.
import type { Area, Check } from "@track-studio/engine";
import { ArrowRightLeft, ChevronLeft, Redo2, Undo2 } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Message, StatusBadge } from "../components/bits.js";
import type { TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import type { Autosave } from "./Designer.js";
import { checkCounts, type DesignerMode } from "./mode.js";

export interface DesignerBarProps {
  backTo: { to: string; label: string };
  name: string;
  onName: (name: string) => void;
  tablet: boolean;
  venueName: string | undefined;
  area: Area;
  /** the saved track */
  status: TrackSummary | undefined;
  /** Quick mode's steps: shown in Quick, and while laying */
  steps: { show: boolean; step: 1 | 2; canGoBack: boolean; armed: boolean; onBack: () => void };
  view: DesignerMode;
  onView: (m: DesignerMode) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reverse: () => void;
  canReverse: boolean;
  reverseTitle: string;
  mode: "new" | "edit";
  dirty: boolean;
  /** the saved track's revision; none for a new track */
  revision: number | undefined;
  loggedIn: boolean;
  loginUrl: () => string;
  laying: boolean;
  saving: boolean;
  saveOpen: boolean;
  setSaveOpen: Dispatch<SetStateAction<boolean>>;
  note: string;
  setNote: (note: string) => void;
  onSave: () => void;
  showSubmit: boolean;
  onSubmit: () => void;
  /** why Submit waits, if it does */
  blocked: string | null;
  /** Quick's right-hand column has no checks (#113): the reason is shown by the button */
  quickSide: boolean;
  /** #submit-why is on the page (by the button, or under the checks) */
  whyShown: boolean;
  checks: Check[];
  onSeeChecks: () => void;
}

export function DesignerBar({ backTo, name, onName, tablet, venueName, area, status, steps, view, onView, undo, redo, canUndo, canRedo, reverse, canReverse, reverseTitle, mode, dirty, revision, loggedIn, loginUrl, laying, saving, saveOpen, setSaveOpen, note, setNote, onSave, showSubmit, onSubmit, blocked, quickSide, whyShown, checks, onSeeChecks }: DesignerBarProps) {
  return (
    <div className="designer-bar">
      <Link to={backTo.to} className="btn btn-quiet btn-icon back" aria-label={backTo.label} title={backTo.label}>
        <ChevronLeft size={20} aria-hidden="true" />
      </Link>
      <input className="name-input" aria-label="Track name" value={name} maxLength={80} onChange={(e) => onName(e.target.value)} />
      <span className="designer-venue" hidden={tablet}>
        {venueName ? `${venueName} · ` : ""}
        {fmt.size(area, true)}
      </span>
      {status && <StatusBadge status={status.status} />}
      {steps.show && <Steps step={steps.step} canGoBack={steps.canGoBack} armed={steps.armed} onBack={steps.onBack} />}
      <div className="mode-toggle" role="group" aria-label="Mode">
        {(["quick", "advanced"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={view === m} onClick={() => onView(m)} title={m === "quick" ? "The essentials: move, add and delete corners, jumps, start line" : "Everything: corner radius, lane widths, outside corners, fine and free snapping, all checks"}>
            {m === "quick" ? "Quick" : "Advanced"}
          </button>
        ))}
      </div>
      {!tablet && (
        <>
          <button type="button" className="btn btn-icon" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={20} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={20} aria-hidden="true" />
          </button>
        </>
      )}
      {!tablet && (
        <button type="button" className="btn" onClick={reverse} disabled={!canReverse} title={reverseTitle}>
          <ArrowRightLeft size={18} aria-hidden="true" />
          Reverse direction
        </button>
      )}
      <span className="save-state" aria-live="polite">
        {/* the tablet's bar is one row at 1024 px, as in the mockup: the short form */}
        {dirty ? (tablet ? "Unsaved" : "Unsaved changes · kept on this device") : revision !== undefined ? `Saved · revision ${revision}` : "Not saved yet"}
      </span>
      {loggedIn ? (
        <button type="button" className={`btn ${showSubmit ? "" : "btn-primary"}`} onClick={() => setSaveOpen((o) => !o)} disabled={saving || laying || (!dirty && mode === "edit")} aria-expanded={saveOpen} title={laying ? "Close the loop first" : undefined}>
          {saving ? "Saving…" : mode === "new" ? "Save track" : "Save revision"}
        </button>
      ) : (
        <a className="btn btn-primary" href={loginUrl()}>
          Log in to save
        </a>
      )}
      {showSubmit && (
        <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={!!blocked} aria-describedby={whyShown ? "submit-why" : undefined} title={blocked ?? "Send to the organisers for approval"}>
          Submit track
        </button>
      )}
      {showSubmit && quickSide && blocked && (
        <p id="submit-why" className="submit-why-bar">
          {blocked}
          {checkCounts(checks).errors > 0 && (
            <>
              {" "}
              <button type="button" className="linkish" onClick={onSeeChecks}>
                See Checks
              </button>
            </>
          )}
        </p>
      )}
      {saveOpen && loggedIn && !laying && (
        <form
          className="save-pop"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <label>
            <span>What changed? (optional)</span>
            <input autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={mode === "new" ? "First version" : "e.g. tighter hairpin, moved the double"} />
          </label>
          {status?.approvedRevision && (
            <p className="hint">
              Revision {status.approvedRevision} stays approved — in the library and at meetings — until this new revision is approved.
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : mode === "new" ? "Save track" : `Save as revision ${(revision ?? 0) + 1}`}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setSaveOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Quick mode's steps: 1 lays the lanes, 2 shapes the loop. From step 2, "1 · Lay the lanes" goes back on a second tap,
 * throwing the shaping away (Undo brings it back); only for a loop laid here, since a track opened from the library has
 * no squares to go back to.
 */
function Steps({ step, canGoBack, armed, onBack }: { step: 1 | 2; canGoBack: boolean; armed: boolean; onBack: () => void }) {
  return (
    <ol className="steps" aria-label="Steps">
      {(["Lay the lanes", "Shape it"] as const).map((label, i) => (
        <li key={label} aria-current={step === i + 1 ? "step" : undefined}>
          {step === 2 && i === 0 && canGoBack ? (
            <button type="button" className={`step-back ${armed ? "armed" : ""}`} onClick={onBack} title="Go back to laying the lanes: the shaping is thrown away (Undo brings it back)">
              {armed ? "Tap again to go back" : `1 · ${label}`}
            </button>
          ) : (
            <>
              {i + 1} · {label}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export interface DesignerMessagesProps {
  /** unsaved work from an earlier visit, on offer */
  restore: Autosave | null;
  /** the saved track's revision, if it's saved: an autosave made on another revision says so */
  revision: number | undefined;
  onRestore: () => void;
  onDiscard: () => void;
  loggedIn: boolean;
  message: { kind: "info" | "error"; text: ReactNode } | null;
  approvedRevision: TrackSummary["approvedRevision"] | undefined;
}

/** The messages under the bar: the restore offer, not logged in, what just happened, an approved revision. */
export function DesignerMessages({ restore, revision, onRestore, onDiscard, loggedIn, message, approvedRevision }: DesignerMessagesProps) {
  return (
    <div className="designer-messages">
      {restore && (
        <Message>
          You have unsaved changes from {fmt.dateTime(restore.savedAt)}
          {revision !== undefined && restore.baseRevision !== revision ? ` (made on revision ${restore.baseRevision}; the track is at revision ${revision} now)` : ""}.{" "}
          <button type="button" className="linkish" onClick={onRestore}>
            Restore them
          </button>{" "}
          ·{" "}
          <button type="button" className="linkish" onClick={onDiscard}>
            Discard
          </button>
        </Message>
      )}
      {!loggedIn && <Message>You're not logged in: you can try the designer, and your work is kept on this device, but log in to save it.</Message>}
      {message && <Message kind={message.kind}>{message.text}</Message>}
      {approvedRevision && (
        <Message>
          Revision {approvedRevision} is approved: it stays in the library and at meetings until a newer revision is approved. Saving here creates a new draft.
        </Message>
      )}
    </div>
  );
}
