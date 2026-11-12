// The designer's layouts (#120): one state (the Designer's), three layouts. A phone (under 640 px) gets the view-only
// screen, or with the switch on the phone layout (#122, PhoneLayout.tsx); a tablet (a coarse pointer, in Quick mode)
// the plan with a dock and a sheet over it; otherwise the laptop's bar, palette, plan and side column. The layouts only
// place the pieces; nothing here changes the state.
import type { Area, Built, Obstacle } from "@track-studio/engine";
import { ChevronLeft, Monitor } from "lucide-react";
import { Link } from "react-router-dom";
import { CopyButton } from "../components/bits.js";
import { PlanView } from "../components/PlanView.js";
import type { TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { DesignerBar, DesignerMessages, type DesignerBarProps, type DesignerMessagesProps } from "./DesignerBar.js";
import type { LaneGrid } from "./lanes.js";
import type { DesignerMode } from "./mode.js";
import { ChecksPill, PlanArea, TabletDock, TabletSheet, type PlanAreaProps, type TabletDockProps } from "./PlanOverlays.js";
import { PhoneEditLayout, type BottomToolbarProps, type PhoneHeaderProps } from "./PhoneLayout.js";
import { SidePanel, type PanelProps } from "./SidePanels.js";
import { ToolPalette, type ToolPaletteProps } from "./ToolPalette.js";

export interface PhoneViewProps {
  backTo: { to: string; label: string };
  name: string;
  /** a saved track with nothing unsaved: a link to it can be copied */
  canCopy: boolean;
  laying: boolean;
  area: Area;
  obstacles: Obstacle[];
  built: Built;
  lapLength: number;
  status: TrackSummary | undefined;
}

export interface DesignerLayoutProps {
  /** under 640 px: the view-only screen */
  phone: boolean;
  /** under 640 px with the switch on (#122): the header, the plan and the toolbar; `upright` while it's on its side */
  phoneEdit: { header: PhoneHeaderProps; toolbar: BottomToolbarProps; upright: boolean } | null;
  /** a coarse pointer in Quick mode: the plan with a dock */
  tablet: boolean;
  view: DesignerMode;
  laying: boolean;
  phoneView: PhoneViewProps;
  bar: DesignerBarProps;
  /** the messages under the bar, when there are any */
  messages: DesignerMessagesProps | null;
  palette: ToolPaletteProps;
  planArea: PlanAreaProps;
  /** the side column's and the sheet's panels */
  panels: PanelProps;
  grid: LaneGrid | null;
  built: Built;
  /** the tablet's checks pill, top right of the plan */
  pill: { open: boolean; onToggle: () => void };
  /** the tablet's sheet over the plan */
  sheet: "selection" | "checks" | null;
  onCloseSheet: () => void;
  dock: TabletDockProps;
}

/** Picks the layout: phone, tablet or laptop. */
export function DesignerLayout({ phone, phoneEdit, tablet, view, laying, phoneView, bar, messages, palette, planArea, panels, grid, built, pill, sheet, onCloseSheet, dock }: DesignerLayoutProps) {
  if (phoneEdit) return <PhoneEditLayout view={view} messages={messages} planArea={planArea} {...phoneEdit} />;
  if (phone) return <PhoneLayout {...phoneView} />;
  return (
    <div className={`designer designer-${view} ${tablet ? "designer-touch" : ""}`}>
      <DesignerBar {...bar} />
      {messages && <DesignerMessages {...messages} />}
      <div className="designer-grid">
        {tablet ? (
          <PlanArea {...planArea}>
            {!laying && <ChecksPill checks={panels.checks} pending={panels.pending} open={pill.open} onToggle={pill.onToggle} />}
            {!laying && sheet && (sheet === "checks" || panels.sel) && <TabletSheet sheet={sheet} onClose={onCloseSheet} panels={panels} />}
            <TabletDock {...dock} />
          </PlanArea>
        ) : (
          <>
            <ToolPalette {...palette} />
            <PlanArea {...planArea} />
            <SidePanel {...panels} laying={laying} grid={grid} built={built} />
          </>
        )}
      </div>
    </div>
  );
}

/** A phone: the plan to look at, and "Design on a laptop or tablet". */
export function PhoneLayout({ backTo, name, canCopy, laying, area, obstacles, built, lapLength, status }: PhoneViewProps) {
  return (
    <div className="designer designer-phone">
      <div className="designer-bar">
        <Link to={backTo.to} className="btn btn-quiet btn-icon back" aria-label={backTo.label}>
          <ChevronLeft size={20} aria-hidden="true" />
        </Link>
        <p className="designer-name">{name || "Untitled track"}</p>
      </div>
      <div className="phone-body">
        <div className="empty">
          <Monitor size={36} className="empty-icon" aria-hidden="true" />
          <h1>Design on a laptop or tablet</h1>
          <p>The designer needs a bigger screen. You can look at the plan here, and pick up where you left off on a laptop or tablet.</p>
          {canCopy ? (
            <CopyButton text={window.location.href} label="Copy link to this design" className="btn btn-touch" />
          ) : (
            <p>Changes you haven't saved stay in this browser until you save them.</p>
          )}
        </div>
        <PlanView area={area} obstacles={obstacles} built={laying ? undefined : built} interactive={false} label={`Plan of ${name || "this track"}, view only`} className="phone-plan" />
        <dl className="figures">
          <div>
            <dd>{laying ? "—" : fmt.metres(lapLength)}</dd>
            <dt>Lap</dt>
          </div>
          <div>
            <dd>{built.stats.corners || "—"}</dd>
            <dt>Corners</dt>
          </div>
          <div>
            <dd>{status ? fmt.STATUS_LABEL[status.status] : "Not saved"}</dd>
            <dt>Status</dt>
          </div>
        </dl>
      </div>
    </div>
  );
}
