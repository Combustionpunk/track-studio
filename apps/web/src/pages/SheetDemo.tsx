// A page to try the phone's bottom sheet on (#121): /dev/sheet, in development only (`pnpm dev`, and the Vite server the
// Playwright tests start); a production build has no route to it. A stand-in plan fills the screen over a 64 px
// toolbar; a finger held down on the plan tucks the open sheet away until it lifts, as a drag on a handle will.
// One sheet at a time: the page keeps one "which sheet" state.
import { Ellipsis, PanelBottom } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet, type SheetHeight } from "../components/Sheet.js";

/** the toolbar's height, which the sheet sits above */
const TOOLBAR = 64;

export function SheetDemo() {
  const [which, setWhich] = useState<"panel" | "menu" | null>(null);
  const [height, setHeight] = useState<SheetHeight>("closed");
  const [held, setHeld] = useState(false);
  const show = (w: "panel" | "menu", h: SheetHeight) => (setWhich(w), setHeight(h));
  const onHeight = (h: SheetHeight) => (setHeight(h), h === "closed" && setWhich(null));
  const sheet = (w: "panel" | "menu") => (which === w ? height : "closed");
  return (
    <div className="sheet-demo">
      <div
        className="sheet-demo-plan"
        data-testid="plan"
        onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), setHeld(true))}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
      >
        <p>{held ? "Holding: the sheet is tucked away" : "The plan. Hold a finger here to tuck the sheet away."}</p>
      </div>
      <nav className="sheet-demo-toolbar" aria-label="Demo tools" style={{ height: `calc(${TOOLBAR}px + env(safe-area-inset-bottom, 0px))` }}>
        <Tool label="Peek" icon={<PanelBottom size={20} aria-hidden="true" />} onClick={() => show("panel", "peek")} />
        <Tool label="Full" icon={<PanelBottom size={20} aria-hidden="true" />} onClick={() => show("panel", "full")} />
        <Tool label="Menu" icon={<Ellipsis size={20} aria-hidden="true" />} onClick={() => show("menu", "peek")} />
      </nav>
      <Sheet label="Corner 7" height={sheet("panel")} onHeight={onHeight} tucked={held} below={TOOLBAR}>
        <h2>Corner 7</h2>
        <p>Pull the grab bar up for the full height, down past peek to close.</p>
        <button type="button" className="btn btn-touch">
          Outside corner
        </button>
        {Array.from({ length: 24 }, (_, i) => (
          <p key={i}>Row {i + 1}: something to scroll through at full height.</p>
        ))}
      </Sheet>
      <Sheet label="More" height={sheet("menu")} onHeight={onHeight} modal below={TOOLBAR}>
        <h2>More</h2>
        <button type="button" className="btn btn-touch">
          Save revision
        </button>
        <button type="button" className="btn btn-touch">
          Zoom to fit
        </button>
      </Sheet>
    </div>
  );
}

function Tool({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="sheet-demo-tool" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
