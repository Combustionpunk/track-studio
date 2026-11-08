// The 3D view of a layout (#83): three.js draws the scene built by scene.ts (from `built` only). Loaded on its own
// when 3D is opened, so three.js isn't in the main bundle. Orbit, pan and zoom with mouse, touch or keyboard; it
// draws only when something changes, so it costs nothing while you look.
import type { Area, Built } from "@track-studio/engine";
import { House, Route, SquareDashed, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { areaBounds } from "../lib/plan.js";
import { homePose, topPose, type Pose } from "./camera.js";
import { buildScene, type Part } from "./scene.js";

const FOV = 45;
/** Flat layers over the floor, lowest first. */
const FLAT_LAYER: Partial<Record<Part, number>> = { carpet: 1, startA: 2, startB: 2, line: 3 };

export interface Viewer3DProps {
  area: Area;
  built: Built;
  label: string;
  className?: string;
  /** WebGL couldn't start after all (the page shows the 2D plan instead) */
  onUnsupported?: () => void;
}

interface Stage {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  line?: Mesh;
  render: () => void;
}

export default function Viewer3D({ area, built, label, className = "", onUnsupported }: Viewer3DProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [showLine, setShowLine] = useState(false);
  const [ready, setReady] = useState(false);
  const scene = useMemo(() => buildScene({ area, built }), [area, built]);
  const bounds = useMemo(() => areaBounds(area), [area]);
  const lineRef = useRef(showLine);
  lineRef.current = showLine;

  useEffect(() => {
    const box = boxRef.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      onUnsupported?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.className = "plan3d-canvas";
    canvas.setAttribute("aria-hidden", "true");
    box.prepend(canvas);

    const world = new Scene();
    world.background = new Color(scene.background);
    world.add(new HemisphereLight(0xffffff, scene.background, 2.2));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6 * area.length, Math.max(area.length, area.width), 0.9 * area.width); // from the south-west, high
    world.add(sun);

    const geometries: BufferGeometry[] = [];
    const materials: MeshLambertMaterial[] = [];
    let line: Mesh | undefined;
    for (const m of scene.meshes) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(m.positions, 3));
      g.setAttribute("normal", new BufferAttribute(m.normals, 3));
      g.setIndex(new BufferAttribute(m.indices, 1));
      const mat = new MeshLambertMaterial({ color: m.colour, side: DoubleSide });
      const mesh = new Mesh(g, mat);
      // the flat layers are millimetres apart: far off, depth can't tell them apart, so they're layered by hand
      if (m.part === "area") {
        mat.depthWrite = false;
        mesh.renderOrder = -1;
      } else if (FLAT_LAYER[m.part]) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -FLAT_LAYER[m.part]!;
        mat.polygonOffsetUnits = -4 * FLAT_LAYER[m.part]!;
      }
      if (m.part === "line") {
        line = mesh;
        mesh.visible = lineRef.current;
      }
      world.add(mesh);
      geometries.push(g);
      materials.push(mat);
    }

    const camera = new PerspectiveCamera(FOV, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, canvas);
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the floor
    controls.minDistance = 1;
    controls.zoomToCursor = true;
    controls.listenToKeyEvents(box); // arrows pan; Shift / Ctrl + arrows orbit

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(world, camera);
        box.dataset.ready = "1";
        box.dataset.camera = camera.position.toArray().map((v) => v.toFixed(2)).join(" "); // for the browser tests
      });
    };
    controls.addEventListener("change", render);
    stage.current = { renderer, camera, controls, line, render };

    let posed = false;
    const resize = () => {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!posed) {
        posed = true;
        apply(stage.current!, homePose(area, FOV, w / h), area);
        setReady(true);
      }
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    const lost = (e: Event) => {
      e.preventDefault();
      onUnsupported?.();
    };
    canvas.addEventListener("webglcontextlost", lost);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", lost);
      controls.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
      stage.current = null;
      delete box.dataset.ready;
      delete box.dataset.camera;
    };
  }, [scene, area, onUnsupported]);

  useEffect(() => {
    const s = stage.current;
    if (!s?.line) return;
    s.line.visible = showLine;
    s.render();
  }, [showLine]);

  const pose = (which: "home" | "top") => {
    const s = stage.current;
    if (!s) return;
    apply(s, (which === "home" ? homePose : topPose)(area, FOV, s.camera.aspect), area);
  };
  const zoom = (k: number) => {
    const s = stage.current;
    if (!s) return;
    const { camera, controls } = s;
    const d = camera.position.clone().sub(controls.target).multiplyScalar(k);
    if (d.length() < controls.minDistance || d.length() > controls.maxDistance) return;
    camera.position.copy(controls.target).add(d);
    controls.update();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "+" || e.key === "=") zoom(1 / 1.25);
    else if (e.key === "-" || e.key === "_") zoom(1.25);
    else if (e.key === "0") pose("home");
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={boxRef}
      className={`plan plan3d ${className}`}
      style={{ "--plan-ratio": `${bounds.x1 - bounds.x0} / ${bounds.y1 - bounds.y0}` } as React.CSSProperties}
      role="img"
      aria-label={label}
      aria-describedby="plan3d-keys"
      tabIndex={0}
      onKeyDown={onKey}
      data-triangles={scene.triangles}
    >
      <p id="plan3d-keys" className="sr-only">
        Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom. Keys: arrows pan, Shift and arrows orbit, plus and minus zoom, 0 resets the view.
      </p>
      {ready && (
        <div className="plan-controls" role="toolbar" aria-label="3D view">
          <button type="button" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomIn size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out (−)">
            <ZoomOut size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => pose("home")} aria-label="Reset view" title="Reset view (0)">
            <House size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => pose("top")} aria-label="Top view" title="Top view">
            <SquareDashed size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setShowLine((v) => !v)} aria-pressed={showLine} aria-label="Racing line" title="Racing line" className={showLine ? "on" : ""}>
            <Route size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function apply(s: Stage, p: Pose, area: Area) {
  const { camera, controls } = s;
  camera.position.set(...p.position);
  controls.target.set(...p.target);
  const d = Math.hypot(...p.position);
  controls.maxDistance = Math.max(4 * d, Math.hypot(area.length, area.width) * 3);
  controls.update();
  s.render();
}
