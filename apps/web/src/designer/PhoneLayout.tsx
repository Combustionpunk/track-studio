// The designer on a phone (#122; mockup docs/design/phone/01-plan-toolbar.html): a 52 px header, the plan, and a
// 64 px toolbar within thumb reach; on its side, a message to turn the phone upright over the plan. Behind the
// `?phone=edit` switch until saving comes to the phone (ticket 5); without it a phone gets the view-only screen.
import { ChevronLeft, Ellipsis, LayoutGrid, MousePointer2, Plus, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { DesignerMessages, type DesignerMessagesProps } from "./DesignerBar.js";
import { PlanArea, type PlanAreaProps } from "./PlanOverlays.js";
import type { DesignerMode } from "./mode.js";

export interface PhoneHeaderProps {
  backTo: { to: string; label: string };
  name: string;
  dirty: boolean;
  /** the saved track's revision; none for a new track */
  revision: number | undefined;
}

/** The phone's header: Back, the name (read only; it truncates), the save state in a word, and ⋯ (its menu comes with ticket 5). */
export function PhoneHeader({ backTo, name, dirty, revision }: PhoneHeaderProps) {
  return (
    <header className="phone-header">
      <Link to={backTo.to} className="phone-icon-btn" aria-label={backTo.label}>
        <ChevronLeft size={20} aria-hidden="true" />
      </Link>
      <p className="phone-name">{name || "Untitled track"}</p>
      <span className="phone-save" aria-live="polite">
        {dirty ? "Unsaved" : revision !== undefined ? "Saved" : "Not saved yet"}
      </span>
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
}

function Tool({ icon, label, ...rest }: { icon: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="phone-tool" {...rest}>
      {icon}
      <span className="phone-tool-label">{label}</span>
    </button>
  );
}

/** The phone's toolbar: Select · Add point · Jump · Delete · Undo · Redo. Jump's sheet comes with ticket 4: shown, disabled. */
export function BottomToolbar({ tool, onSelect, onAdd, canDelete, onDelete, undo, redo, canUndo, canRedo }: BottomToolbarProps) {
  return (
    <nav className="phone-toolbar" role="toolbar" aria-label="Designer tools">
      <Tool icon={<MousePointer2 size={20} aria-hidden="true" />} label="Select" aria-pressed={tool === "select"} onClick={onSelect} />
      <Tool icon={<Plus size={20} aria-hidden="true" />} label="Add point" aria-pressed={tool === "add"} data-add-tool onClick={onAdd} />
      <Tool icon={<LayoutGrid size={20} aria-hidden="true" />} label="Jump" disabled />
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
}

/** A phone: the header, the plan between, the toolbar; on its side, "Turn your phone upright to edit" over it all. */
export function PhoneEditLayout({ view, header, messages, planArea, toolbar, upright }: PhoneEditLayoutProps) {
  return (
    <div className={`designer designer-phone-edit designer-${view}`}>
      <PhoneHeader {...header} />
      {messages && <DesignerMessages {...messages} />}
      <PlanArea {...planArea} viewSwitch={false} />
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
