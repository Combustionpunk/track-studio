// The designer on a phone (#122; mockup docs/design/phone/01-plan-toolbar.html): a 52 px header, the plan, and a
// 64 px toolbar within thumb reach; on its side, a message to turn the phone upright over the plan. The default under
// 640 px since #124. Under the header, the messages as one banner; over the plan, the checks pill; above the toolbar,
// one sheet at a time (#123, PhoneSheets.tsx), and the ⋯ menu over everything (#124, PhoneMenu.tsx).
import { Box, ChevronLeft, Ellipsis, LayoutGrid, LogIn, Map as MapIcon, MousePointer2, Plus, Redo2, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import type { Check } from "@track-studio/engine";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Message } from "../components/bits.js";
import * as fmt from "../lib/format.js";
import type { DesignerMessagesProps } from "./DesignerBar.js";
import { ChecksPill, PlanArea, type PlanAreaProps } from "./PlanOverlays.js";
import { PhoneSheets, type PhoneSheetsProps } from "./PhoneSheets.js";
import type { DesignerMode } from "./mode.js";

export interface PhoneHeaderProps {
  backTo: { to: string; label: string };
  name: string;
  dirty: boolean;
  /** the saved track's revision; none for a new track */
  revision: number | undefined;
  loggedIn: boolean;
  loginUrl: string;
  saving: boolean;
  /** the Save sheet is open */
  saveOpen: boolean;
  /** opens the Save sheet (or puts it away) */
  onSave: () => void;
  /** the ⋯ menu is open */
  menuOpen: boolean;
  onMenu: () => void;
}

/**
 * The phone's header: Back, the name (read only; it truncates), the save state and ⋯. With something to save the save
 * state is a 44 px Save button that opens the Save sheet (one tap, #124), or a link to log in; otherwise the word "Saved".
 */
export function PhoneHeader({ backTo, name, dirty, revision, loggedIn, loginUrl, saving, saveOpen, onSave, menuOpen, onMenu }: PhoneHeaderProps) {
  const toSave = dirty || revision === undefined;
  return (
    <header className="phone-header">
      <Link to={backTo.to} className="phone-icon-btn" aria-label={backTo.label}>
        <ChevronLeft size={20} aria-hidden="true" />
      </Link>
      <p className="phone-name">{name || "Untitled track"}</p>
      <span className="phone-save" aria-live="polite">
        {!toSave ? (
          "Saved"
        ) : !loggedIn ? (
          <a className="phone-save-btn" href={loginUrl}>
            <LogIn size={18} aria-hidden="true" />
            Log in
          </a>
        ) : (
          <button type="button" className="phone-save-btn" disabled={saving} aria-haspopup="dialog" aria-expanded={saveOpen} onClick={onSave}>
            <Save size={18} aria-hidden="true" />
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </span>
      <button type="button" className="phone-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={onMenu}>
        <Ellipsis size={20} aria-hidden="true" />
      </button>
    </header>
  );
}

export interface PhoneBannerProps extends DesignerMessagesProps {
  loginUrl: string;
  /** the notes put away this visit: "login", "approved" */
  dismissed: string[];
  /** put a note away: "message" (what just happened), "login" or "approved" */
  onDismiss: (key: "message" | "login" | "approved") => void;
}

/**
 * The messages under the phone's header as one banner. The restore prompt stays while there is unsaved work on offer
 * (no Dismiss: it is the only way back to that work, and Discard is its answer); under it, the one note that matters
 * most of what just happened (a save, an error), not logged in and an approved revision, which can be dismissed.
 */
export function PhoneBanner({ restore, revision, onRestore, onDiscard, loggedIn, loginUrl, message, approvedRevision, dismissed, onDismiss }: PhoneBannerProps) {
  const dismiss = (key: "message" | "login" | "approved") => (
    <button type="button" className="phone-banner-x" aria-label="Dismiss" onClick={() => onDismiss(key)}>
      <X size={18} aria-hidden="true" />
    </button>
  );
  const note = message ? (
    <Message kind={message.kind}>
      <span>{message.text}</span>
      {dismiss("message")}
    </Message>
  ) : !loggedIn && !dismissed.includes("login") ? (
    <Message>
      <span>
        You're not logged in: your work is kept on this device. <a href={loginUrl}>Log in</a> to save it.
      </span>
      {dismiss("login")}
    </Message>
  ) : approvedRevision && !dismissed.includes("approved") ? (
    <Message>
      <span>Revision {approvedRevision} is approved: it stays in the library and at meetings until a newer revision is approved. Saving here creates a new draft.</span>
      {dismiss("approved")}
    </Message>
  ) : null;
  if (!restore && !note) return null;
  return (
    <div className="designer-messages phone-banner">
      {restore && (
        <Message>
          <span>
            You have unsaved changes from {fmt.dateTime(restore.savedAt)}
            {revision !== undefined && restore.baseRevision !== revision ? ` (made on revision ${restore.baseRevision}; the track is at revision ${revision} now)` : ""}.{" "}
            <button type="button" className="linkish" onClick={onRestore}>
              Restore them
            </button>{" "}
            ·{" "}
            <button type="button" className="linkish" onClick={onDiscard}>
              Discard
            </button>
          </span>
        </Message>
      )}
      {note}
    </div>
  );
}

export interface BottomToolbarProps {
  /** the tool that's on: Select, Add point, or an armed jump */
  tool: "select" | "add" | "feature";
  onSelect: () => void;
  onAdd: () => void;
  /** a corner or a jump is selected */
  canDelete: boolean;
  onDelete: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Jump: its sheet, open or closed again (Jump is a mode, `aria-pressed` while a jump is armed; the sheet is a dialog of its own) */
  onJump: () => void;
  /** the seventh button (#127), behind its switch: "3D" opens the 3D preview, "2D" goes back to the plan */
  view3d?: { label: "3D" | "2D"; onToggle: () => void };
  /** the 3D preview is showing: Select, Add point, Jump and Delete wait for 2D (undo and redo work, as on a laptop) */
  viewOnly?: boolean;
}

function Tool({ icon, label, ...rest }: { icon: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="phone-tool" {...rest}>
      {icon}
      <span className="phone-tool-label">{label}</span>
    </button>
  );
}

/**
 * The phone's toolbar: Select · Add point · Jump · Delete · Undo · Redo, and 3D behind its switch (#127). Jump opens
 * the Jump sheet; it's pressed while a jump is armed. 3D reads 2D while the preview shows, and the editing tools wait.
 */
export function BottomToolbar({ tool, onSelect, onAdd, canDelete, onDelete, undo, redo, canUndo, canRedo, onJump, view3d, viewOnly = false }: BottomToolbarProps) {
  return (
    <nav className={view3d ? "phone-toolbar phone-toolbar-7" : "phone-toolbar"} role="toolbar" aria-label="Designer tools">
      <Tool icon={<MousePointer2 size={20} aria-hidden="true" />} label="Select" aria-pressed={!viewOnly && tool === "select"} disabled={viewOnly} onClick={onSelect} />
      <Tool icon={<Plus size={20} aria-hidden="true" />} label="Add point" aria-pressed={!viewOnly && tool === "add"} disabled={viewOnly} data-add-tool onClick={onAdd} />
      <Tool icon={<LayoutGrid size={20} aria-hidden="true" />} label="Jump" aria-pressed={!viewOnly && tool === "feature"} disabled={viewOnly} onClick={onJump} />
      <Tool icon={<Trash2 size={20} aria-hidden="true" />} label="Delete" disabled={viewOnly || !canDelete} onClick={onDelete} />
      <Tool icon={<Undo2 size={20} aria-hidden="true" />} label="Undo" disabled={!canUndo} onClick={undo} />
      <Tool icon={<Redo2 size={20} aria-hidden="true" />} label="Redo" disabled={!canRedo} onClick={redo} />
      {view3d && (
        <Tool
          icon={view3d.label === "3D" ? <Box size={20} aria-hidden="true" /> : <MapIcon size={20} aria-hidden="true" />}
          label={view3d.label}
          title={view3d.label === "3D" ? "See the track in 3D (view only)" : "Back to the plan, to edit"}
          onClick={view3d.onToggle}
        />
      )}
    </nav>
  );
}

export interface PhoneEditLayoutProps {
  view: DesignerMode;
  header: PhoneHeaderProps;
  /** the messages under the header, as one banner */
  banner: PhoneBannerProps;
  planArea: PlanAreaProps;
  toolbar: BottomToolbarProps;
  /** a phone on its side: the message over the layout, which stays (nothing unmounts) */
  upright: boolean;
  /** the checks pill, top right of the plan: opens Checks, in both modes */
  pill: { checks: Check[]; pending: boolean; open: boolean; onToggle: () => void };
  sheets: PhoneSheetsProps;
  /** with the 3D switch on (#127): how long 3D took to draw, and the last orbit, for the Board to write down */
  figures3d?: string;
}

/** A phone: the header, the plan between, the toolbar; on its side, "Turn your phone upright to edit" over it all. */
export function PhoneEditLayout({ view, header, banner, planArea, toolbar, upright, pill, sheets, figures3d }: PhoneEditLayoutProps) {
  return (
    <div className={`designer designer-phone-edit designer-${view}`}>
      <PhoneHeader {...header} />
      <PhoneBanner {...banner} />
      <PlanArea {...planArea} viewSwitch={false} noContextMenu>
        <ChecksPill {...pill} />
        {figures3d && <p className="phone-3d-figures">{figures3d}</p>}
      </PlanArea>
      <PhoneSheets {...sheets} />
      <BottomToolbar {...toolbar} />
      {upright && (
        <div className="phone-upright" role="alert">
          <div className="phone-upright-card">
            <RotateCcw size={36} className="empty-icon" aria-hidden="true" />
            <p className="phone-upright-title">Turn your phone upright to edit</p>
            <p>The designer needs the phone upright. Nothing is lost: your changes are still here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
