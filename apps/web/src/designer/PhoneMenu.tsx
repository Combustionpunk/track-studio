// The phone designer's ⋯ menu and the sheets it opens (#124; mockup docs/design/phone/04-overflow-menu.html): the
// overflow menu is the one modal sheet, over a scrim, with the things done once per session (Save revision, Submit
// track and why it waits, Mode, Reverse direction, Zoom to fit, Layout details, How to draw, Back to track); the Save
// sheet is the desktop's note pop-over; Layout details has the name (edited here on a phone), the venue and size, the
// status and the description. The Designer owns the state; these only draw it.
import type { Area, Check } from "@track-studio/engine";
import { ArrowRightLeft, ChevronLeft, CircleQuestionMark, Pencil, Save, Scan, Send, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../components/bits.js";
import type { TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import type { DesignerMode } from "./mode.js";

/**
 * Why Submit waits, short enough for the menu row's second line (the desktop's longer reason is under its Checks):
 * errors first, then unsaved changes, then a bake still running; null when it can go.
 */
export function submitWhy({ dirty, pending, checks }: { dirty: boolean; pending: boolean; checks: Check[] }): string | null {
  const errors = checks.filter((c) => c.level === "error").length;
  if (errors) return `Waiting on ${errors} ${errors === 1 ? "error" : "errors"} · see Checks`;
  if (dirty) return "Save your changes first";
  if (pending) return "Checking the track…";
  return null;
}

export interface PhoneMenuProps {
  view: DesignerMode;
  onView: (m: DesignerMode) => void;
  /** the primary row: its label ("Save revision", "Save track"), the save state under it; logs in instead when `loginUrl` */
  save: { label: string; state: string; disabled: boolean; loginUrl: string | null; onSave: () => void };
  /** why Submit waits (its row is disabled and says so), or null when it can go; `onSeeChecks` when Checks has the reason */
  submit: { why: string | null; onSubmit: () => void; onSeeChecks: (() => void) | null };
  reverse: { onReverse: () => void; canReverse: boolean };
  onFit: () => void;
  onDetails: () => void;
  onHowTo: () => void;
  backTo: { to: string; label: string };
}

const ITEMS = '[role^="menuitem"]:not([disabled])';

function Row({ icon, label, sub, primary = false, ...rest }: { icon: ReactNode; label: string; sub?: string; primary?: boolean; onClick?: () => void; disabled?: boolean; "aria-disabled"?: boolean }) {
  return (
    <li role="none">
      <button type="button" role="menuitem" className={`phone-menu-item${primary ? " phone-menu-primary" : ""}`} {...rest}>
        {icon}
        <span className="phone-menu-text">
          {label}
          {sub && <small>{sub}</small>}
        </span>
      </button>
    </li>
  );
}

/**
 * A `role="menu"` list's keys (the ⋯ menu, the context sheet): opened, its first row that can take the focus has it;
 * the arrow keys (round the ends), Home and End move between the rows. Enter is the row's own button; Escape is the
 * Sheet's. Rows that are `disabled` are skipped; `aria-disabled` ones take the focus, so their reason is read out.
 */
export function useMenuKeys(): { ref: RefObject<HTMLUListElement | null>; onKeyDown: (e: KeyboardEvent) => void } {
  const ref = useRef<HTMLUListElement>(null);
  // a frame later, so the Sheet notes what had the focus before as where it goes back to when the sheet closes
  useEffect(() => {
    const f = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(ITEMS)?.focus());
    return () => cancelAnimationFrame(f);
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    const all = [...ref.current!.querySelectorAll<HTMLElement>(ITEMS)];
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % all.length : e.key === "ArrowUp" ? (at - 1 + all.length) % all.length : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    all[to].focus();
  };
  return { ref, onKeyDown };
}

/** The overflow menu's rows: `role="menu"`, with the arrow keys, Home and End moving between them. */
export function PhoneMenu({ view, onView, save, submit, reverse, onFit, onDetails, onHowTo, backTo }: PhoneMenuProps) {
  const { ref, onKeyDown: keys } = useMenuKeys();
  const icon = (I: typeof Save) => <I size={20} aria-hidden="true" />;
  return (
    <ul ref={ref} className="phone-menu" role="menu" aria-label="More" onKeyDown={keys}>
      {save.loginUrl ? (
        <li role="none">
          <a role="menuitem" className="phone-menu-item phone-menu-primary" href={save.loginUrl}>
            {icon(Save)}
            <span className="phone-menu-text">
              Log in to save
              <small>{save.state}</small>
            </span>
          </a>
        </li>
      ) : (
        <Row icon={icon(Save)} label={save.label} sub={save.state} primary disabled={save.disabled} onClick={save.onSave} />
      )}
      {/* a blocked Submit stays focusable (aria-disabled) so its reason is read out; a tap on it opens Checks when the
          reason is there */}
      <Row
        icon={icon(Send)}
        label="Submit track"
        sub={submit.why ?? "Send it to the organisers for approval"}
        aria-disabled={submit.why ? true : undefined}
        onClick={submit.why ? (submit.onSeeChecks ?? undefined) : submit.onSubmit}
      />
      <li role="none" className="phone-menu-row">
        <span className="phone-menu-text" id="phone-mode-l">
          {icon(SlidersHorizontal)}
          Mode
        </span>
        <div className="seg phone-menu-seg" role="group" aria-labelledby="phone-mode-l">
          {(["quick", "advanced"] as const).map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={view === m} className={view === m ? "on" : ""} onClick={() => onView(m)}>
              {m === "quick" ? "Quick" : "Advanced"}
            </button>
          ))}
        </div>
      </li>
      <Row icon={icon(ArrowRightLeft)} label="Reverse direction" disabled={!reverse.canReverse} onClick={reverse.onReverse} />
      <Row icon={icon(Scan)} label="Zoom to fit" onClick={onFit} />
      <Row icon={icon(Pencil)} label="Layout details" sub="Name, venue, description" onClick={onDetails} />
      <Row icon={icon(CircleQuestionMark)} label="How to draw" onClick={onHowTo} />
      <li role="none">
        <Link role="menuitem" className="phone-menu-item" to={backTo.to}>
          {icon(ChevronLeft)}
          <span className="phone-menu-text">{backTo.label}</span>
        </Link>
      </li>
    </ul>
  );
}

export interface PhoneSaveProps {
  mode: "new" | "edit";
  note: string;
  setNote: (note: string) => void;
  onSave: () => void;
  saving: boolean;
  /** the saved track's revision; none for a new track */
  revision: number | undefined;
  approvedRevision: TrackSummary["approvedRevision"] | null | undefined;
}

/** The Save sheet: "What changed?" and the Save button, as the desktop's note pop-over. */
export function PhoneSave({ mode, note, setNote, onSave, saving, revision, approvedRevision }: PhoneSaveProps) {
  return (
    <form
      className="phone-save-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label className="nfield wide">
        <span>What changed? (optional)</span>
        <input value={note} maxLength={500} enterKeyHint="done" onChange={(e) => setNote(e.target.value)} placeholder={mode === "new" ? "First version" : "e.g. tighter hairpin, moved the double"} />
      </label>
      {approvedRevision && <p className="hint">Revision {approvedRevision} stays approved — in the library and at meetings — until this new revision is approved.</p>}
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : mode === "new" ? "Save track" : `Save as revision ${(revision ?? 0) + 1}`}
      </button>
    </form>
  );
}

export interface PhoneDetailsProps {
  name: string;
  onName: (name: string) => void;
  description: string | undefined;
  onDescription: (description: string) => void;
  venueName: string | undefined;
  area: Area;
  /** the saved track */
  status: TrackSummary | undefined;
}

/** Layout details: the name (the header's is read only on a phone), the venue and size, the status, the description. */
export function PhoneDetails({ name, onName, description, onDescription, venueName, area, status }: PhoneDetailsProps) {
  return (
    <div className="phone-details">
      <label className="nfield wide">
        <span>Name</span>
        <input value={name} maxLength={80} enterKeyHint="done" onChange={(e) => onName(e.target.value)} />
      </label>
      <dl className="phone-details-facts">
        <div>
          <dt>Venue and size</dt>
          <dd>
            {venueName ? `${venueName} · ` : ""}
            {fmt.size(area, true)}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status ? <StatusBadge status={status.status} /> : "Not saved yet"}</dd>
        </div>
      </dl>
      <label className="nfield wide">
        <span>Description</span>
        <textarea rows={3} value={description ?? ""} maxLength={2000} onChange={(e) => onDescription(e.target.value)} />
      </label>
    </div>
  );
}
