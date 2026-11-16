// The designer on a phone (#122; mockup docs/design/phone/01-plan-toolbar.html): a 52 px header, the plan, and a
// 64 px toolbar within thumb reach; on its side, a message to turn the phone upright over the plan. Behind the
// `?phone=edit` switch until saving comes to the phone (ticket 5); without it a phone gets the view-only screen. Over the
// plan, the checks pill; above the toolbar, one sheet at a time (#123, PhoneSheets.tsx).
import { ChevronLeft, CircleQuestionMark, Ellipsis, LayoutGrid, MousePointer2, Plus, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import type { Check } from "@track-studio/engine";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { DesignerMessages, type DesignerMessagesProps } from "./DesignerBar.js";
import { ChecksPill, PlanArea, type PlanAreaProps } from "./PlanOverlays.js";
import { PhoneSheets, type PhoneSheetsProps } from "./PhoneSheets.js";
import type { DesignerMode } from "./mode.js";

export interface PhoneHeaderProps {
  backTo: { to: string; label: string };
  name: string;
  dirty: boolean;
  /** the saved track's revision; none for a new track */
  revision: number | undefined;
  /** How to draw, from the header until the ⋯ menu comes (ticket 5) */
  onHelp: () => void;
  helpOpen: boolean;
}

/** The phone's header: Back, the name (read only; it truncates), the save state in a word, and ⋯ (its menu comes with ticket 5). */
export function PhoneHeader({ backTo, name, dirty, revision, onHelp, helpOpen }: PhoneHeaderProps) {
  return (
    <header className="phone-header">
      <Link to={backTo.to} className="phone-icon-btn" aria-label={backTo.label}>
        <ChevronLeft size={20} aria-hidden="true" />
      </Link>
      <p className="phone-name">{name || "Untitled track"}</p>
      <span className="phone-save" aria-live="polite">
        {dirty ? "Unsaved" : revision !== undefined ? "Saved" : "Not saved yet"}
      </span>
      {/* for now: How to draw moves into the ⋯ menu with ticket 5 */}
      <button type="button" className="phone-icon-btn" aria-label="How to draw" aria-expanded={helpOpen} onClick={onHelp}>
        <CircleQuestionMark size={20} aria-hidden="true" />
      </button>
      <button type="button" className="phone-icon-btn" aria-label="More" aria-haspopup="menu" disabled>
        <Ellipsis size={20} aria-hidden="true" />
      </button>
    </header>
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
}

function Tool({ icon, label, ...rest }: { icon: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="phone-tool" {...rest}>
      {icon}
      <span className="phone-tool-label">{label}</span>
    </button>
  );
}

/** The phone's toolbar: Select · Add point · Jump · Delete · Undo · Redo. Jump opens the Jump sheet; it's pressed while a jump is armed. */
export function BottomToolbar({ tool, onSelect, onAdd, canDelete, onDelete, undo, redo, canUndo, canRedo, onJump }: BottomToolbarProps) {
  return (
    <nav className="phone-toolbar" role="toolbar" aria-label="Designer tools">
      <Tool icon={<MousePointer2 size={20} aria-hidden="true" />} label="Select" aria-pressed={tool === "select"} onClick={onSelect} />
      <Tool icon={<Plus size={20} aria-hidden="true" />} label="Add point" aria-pressed={tool === "add"} data-add-tool onClick={onAdd} />
      <Tool icon={<LayoutGrid size={20} aria-hidden="true" />} label="Jump" aria-pressed={tool === "feature"} onClick={onJump} />
      <Tool icon={<Trash2 size={20} aria-hidden="true" />} label="Delete" disabled={!canDelete} onClick={onDelete} />
      <Tool icon={<Undo2 size={20} aria-hidden="true" />} label="Undo" disabled={!canUndo} onClick={undo} />
      <Tool icon={<Redo2 size={20} aria-hidden="true" />} label="Redo" disabled={!canRedo} onClick={redo} />
    </nav>
  );
}

export interface PhoneEditLayoutProps {
  view: DesignerMode;
  header: PhoneHeaderProps;
  /** the messages under the header, when there are any */
  messages: DesignerMessagesProps | null;
  planArea: PlanAreaProps;
  toolbar: BottomToolbarProps;
  /** a phone on its side: the message over the layout, which stays (nothing unmounts) */
  upright: boolean;
  /** the checks pill, top right of the plan: opens Checks, in both modes */
  pill: { checks: Check[]; pending: boolean; open: boolean; onToggle: () => void };
  sheets: PhoneSheetsProps;
}

/** A phone: the header, the plan between, the toolbar; on its side, "Turn your phone upright to edit" over it all. */
export function PhoneEditLayout({ view, header, messages, planArea, toolbar, upright, pill, sheets }: PhoneEditLayoutProps) {
  return (
    <div className={`designer designer-phone-edit designer-${view}`}>
      <PhoneHeader {...header} />
      {messages && <DesignerMessages {...messages} />}
      <PlanArea {...planArea} viewSwitch={false}>
        <ChecksPill {...pill} />
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
