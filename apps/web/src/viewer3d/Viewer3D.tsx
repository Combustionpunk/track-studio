// The 3D view of a layout (#83): three.js draws the scene built by scene.ts (from `built` only). Loaded on its own
// when 3D is opened, so three.js isn't in the main bundle. Orbit, pan and zoom with mouse, touch or keyboard; it
// draws only when something changes, so it costs nothing while you look. The rostrum view (#84) stands the camera
// where the drivers stand on a side: looking around turns the head there, and zoom narrows the field of view.
import type { Area, Built, Side } from "@track-studio/engine";
import { House, Orbit, Route, SquareDashed, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { areaBounds } from "../lib/plan.js";
import { headPose, homePose, rostrumHead, topPose, turnHead, zoomHead, type Head, type Pose } from "./camera.js";
import { SIDES } from "./rostrum.js";
import { buildScene, rostrumMeshes, type MeshData, type Part } from "./scene.js";

const FOV = 45;
/** Flat layers over the floor, lowest first. */
const FLAT_LAYER: Partial<Record<Part, number>> = { carpet: 1, startA: 2, startB: 2, line: 3 };
/** Arrow keys turn the head this far at the rostrum (degrees). */
const TURN_STEP = 5;

export interface Viewer3DProps {
  area: Area;
  built: Built;
  label: string;
  className?: string;
  /** WebGL couldn't start after all ("none"), or stopped ("lost", e.g. a graphics reset): the page shows the 2D plan */
  onUnsupported?: (why: "none" | "lost") => void;
  /** the rostrum drawn (picked, else the default), and whether the camera stands on it (#84) */
  rostrum: { side: Side; at: boolean };
  onRostrum: (side: Side, at: boolean) => void;
}

interface Stage {
  renderer: WebGLRenderer;
  world: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  line?: Mesh;
  render: () => void;
  /** at the rostrum: which way the head turns (null: orbiting) */
  head: Head | null;
  /** the orbit camera from before standing at the rostrum, to go back to */
  orbit?: { position: Pose["position"]; target: Pose["target"] };
}

const SIDE_NAME = (s: Side) => s[0].toUpperCase() + s.slice(1);

export default function Viewer3D({ area, built, label, className = "", onUnsupported, rostrum, onRostrum }: Viewer3DProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const keysId = useId();
  const stage = useRef<Stage | null>(null);
  const [showLine, setShowLine] = useState(false);
  const [ready, setReady] = useState(false);
  const scene = useMemo(() => buildScene({ area, built }), [area, built]);
  const bounds = useMemo(() => areaBounds(area), [area]);
  const lineRef = useRef(showLine);
  lineRef.current = showLine;
  const rostrumRef = useRef(rostrum);
  rostrumRef.current = rostrum;

  useEffect(() => {
    const box = boxRef.current!, stageEl = stageRef.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      onUnsupported?.("none");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.className = "plan3d-canvas";
    canvas.setAttribute("aria-hidden", "true");
    stageEl.append(canvas);

    const world = new Scene();
    world.background = new Color(scene.background);
    // white light (three's default colour): from the sky, and back up off the floor in its colour
    world.add(new HemisphereLight(undefined, scene.background, 2.2));
    const sun = new DirectionalLight(undefined, 1.6);
    sun.position.set(-0.6 * area.length, Math.max(area.length, area.width), 0.9 * area.width); // from the south-west, high
    world.add(sun);

    const geometries: BufferGeometry[] = [];
    const materials: MeshLambertMaterial[] = [];
    let line: Mesh | undefined;
    for (const m of scene.meshes) {
      const mesh = toMesh(m);
      const mat = mesh.material;
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
      geometries.push(mesh.geometry);
      materials.push(mat);
    }

    const camera = new PerspectiveCamera(FOV, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, canvas);
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the floor
    controls.minDistance = 1;
    controls.zoomToCursor = true;
    controls.listenToKeyEvents(stageEl); // arrows pan; Shift / Ctrl + arrows orbit

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(world, camera);
        box.dataset.ready = "1";
        box.dataset.camera = camera.position.toArray().map((v) => v.toFixed(2)).join(" "); // for the browser tests
        box.dataset.fov = camera.fov.toFixed(1);
        box.dataset.look = camera.getWorldDirection(new Vector3()).toArray().map((v) => v.toFixed(3)).join(" ");
      });
    };
    controls.addEventListener("change", render);
    const s: Stage = { renderer, world, camera, controls, line, render, head: null };
    stage.current = s;

    // at the rostrum, OrbitControls is off and these turn the head: drag (one finger) looks around, the wheel or a
    // pinch narrows or widens the field of view
    const pointers = new Map<number, [number, number]>();
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    const look = (h: Head) => {
      s.head = h;
      poseHead(s, area, rostrumRef.current.side);
    };
    const down = (e: PointerEvent) => {
      if (!s.head) return;
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
    };
    const move = (e: PointerEvent) => {
      const was = pointers.get(e.pointerId);
      if (!s.head || !was) return;
      const before = pointers.size === 2 ? spread() : 0;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) {
        const k = s.head.fov / Math.max(1, box.clientHeight); // degrees per pixel: what's under the pointer stays there
        look(turnHead(s.head, (e.clientX - was[0]) * k, (e.clientY - was[1]) * k));
      } else if (pointers.size === 2 && before > 0) look(zoomHead(s.head, before / Math.max(1, spread())));
    };
    const up = (e: PointerEvent) => void pointers.delete(e.pointerId);
    const wheel = (e: WheelEvent) => {
      if (!s.head) return;
      e.preventDefault();
      look(zoomHead(s.head, e.deltaY > 0 ? 1.1 : 1 / 1.1));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });

    let posed = false;
    const resize = () => {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!posed) {
        posed = true;
        const r = rostrumRef.current;
        if (r.at) stand(s, area, r.side);
        else apply(s, homePose(area, FOV, w / h), area);
        setReady(true);
      }
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    const lost = () => onUnsupported?.("lost");
    canvas.addEventListener("webglcontextlost", lost);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      controls.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
      stage.current = null;
      delete box.dataset.ready;
      delete box.dataset.camera;
      delete box.dataset.fov;
      delete box.dataset.look;
    };
  }, [scene, area, onUnsupported]);

  // the rostrum on its side, in the scene
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const meshes = rostrumMeshes(area, rostrum.side).map(toMesh);
    meshes.forEach((m) => s.world.add(m));
    s.render();
    return () => {
      meshes.forEach((m) => {
        s.world.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
    };
  }, [scene, area, rostrum.side]);

  // standing at the rostrum, or back to the orbit camera
  useEffect(() => {
    const s = stage.current;
    if (!s || !ready) return;
    if (rostrum.at) stand(s, area, rostrum.side);
    else if (s.head) leave(s, area);
  }, [ready, area, rostrum.at, rostrum.side]);

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
    if (s.head) {
      s.head = zoomHead(s.head, k);
      poseHead(s, area, rostrum.side);
      return;
    }
    const { camera, controls } = s;
    const d = camera.position.clone().sub(controls.target).multiplyScalar(k);
    if (d.length() < controls.minDistance || d.length() > controls.maxDistance) return;
    camera.position.copy(controls.target).add(d);
    controls.update();
  };
  const turn = (dYaw: number, dPitch: number) => {
    const s = stage.current;
    if (!s?.head) return;
    s.head = turnHead(s.head, dYaw, dPitch);
    poseHead(s, area, rostrum.side);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    if (rostrum.at) {
      // at the rostrum, the arrows turn the head (OrbitControls is off), 0 looks at the middle again, Escape leaves
      const step: Record<string, [number, number]> = { ArrowLeft: [TURN_STEP, 0], ArrowRight: [-TURN_STEP, 0], ArrowUp: [0, TURN_STEP], ArrowDown: [0, -TURN_STEP] };
      if (step[e.key]) turn(...step[e.key]);
      else if (e.key === "0") stand(stage.current!, area, rostrum.side);
      else if (e.key === "Escape") onRostrum(rostrum.side, false);
      else if (e.key === "+" || e.key === "=") zoom(1 / 1.25);
      else if (e.key === "-" || e.key === "_") zoom(1.25);
      else return;
      e.preventDefault();
      return;
    }
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
      data-triangles={scene.triangles}
      data-view={rostrum.at ? "rostrum" : "orbit"}
    >
      {/* the canvas goes in here; the buttons stay outside it, so they aren't part of the picture */}
      <div
        ref={stageRef}
        className="plan3d-stage"
        role="img"
        aria-label={rostrum.at ? `${label}, from the rostrum on the ${rostrum.side} side` : label}
        aria-describedby={keysId}
        tabIndex={0}
        onKeyDown={onKey}
      />
      <p id={keysId} className="sr-only">
        {rostrum.at
          ? "From the rostrum: drag to look around, scroll or pinch to zoom. Keys: arrows look around, plus and minus zoom, 0 looks at the middle again, Escape goes back to orbit."
          : "Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom. Keys: arrows pan, Shift and arrows orbit, plus and minus zoom, 0 resets the view."}
      </p>
      <p className="sr-only" role="status">
        {ready && rostrum.at ? `Rostrum view from the ${rostrum.side} side` : ""}
      </p>
      {ready && (
        <div className="plan-controls" role="toolbar" aria-label="3D view">
          <button type="button" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomIn size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out (−)">
            <ZoomOut size={18} aria-hidden="true" />
          </button>
          {!rostrum.at && (
            <>
              <button type="button" onClick={() => pose("home")} aria-label="Reset view" title="Reset view (0)">
                <House size={18} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => pose("top")} aria-label="Top view" title="Top view">
                <SquareDashed size={18} aria-hidden="true" />
              </button>
            </>
          )}
          <button type="button" onClick={() => setShowLine((v) => !v)} aria-pressed={showLine} aria-label="Racing line" title="Racing line" className={showLine ? "on" : ""}>
            <Route size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      {ready && (
        <div className="plan3d-rostrum" role="group" aria-label="Rostrum">
          <span aria-hidden="true">Rostrum</span>
          {SIDES.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={rostrum.at && rostrum.side === k}
              aria-label={`Rostrum ${k}`}
              title={`See the track from the ${k} side`}
              className={rostrum.at && rostrum.side === k ? "on" : ""}
              onClick={() => onRostrum(k, true)}
            >
              {SIDE_NAME(k)[0]}
            </button>
          ))}
          {rostrum.at && (
            <button type="button" className="plan3d-orbit" onClick={() => onRostrum(rostrum.side, false)} title="Back to orbit (Esc)">
              <Orbit size={16} aria-hidden="true" />
              <span>Back to orbit</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A mesh for three.js from the scene's data. */
function toMesh(m: MeshData): Mesh<BufferGeometry, MeshLambertMaterial> {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new BufferAttribute(m.normals, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  return new Mesh(g, new MeshLambertMaterial({ color: m.colour, side: DoubleSide }));
}

/** Stand at the rostrum on `side`, looking at the middle; the orbit camera is kept to go back to. */
function stand(s: Stage, area: Area, side: Side) {
  if (!s.head) s.orbit = { position: s.camera.position.toArray() as Pose["position"], target: s.controls.target.toArray() as Pose["target"] };
  s.controls.enabled = false;
  s.head = rostrumHead(area, side);
  poseHead(s, area, side);
}

/** Back to the orbit camera where it was (the starting view if the page opened at the rostrum). */
function leave(s: Stage, area: Area) {
  s.head = null;
  s.controls.enabled = true;
  s.camera.fov = FOV;
  s.camera.updateProjectionMatrix();
  const o = s.orbit;
  s.orbit = undefined;
  apply(s, o && Math.hypot(...o.position) > 0 ? o : homePose(area, FOV, s.camera.aspect), area);
}

/** The camera at the rostrum, looking where the head turns. */
function poseHead(s: Stage, area: Area, side: Side) {
  const p = headPose(area, side, s.head!);
  s.camera.position.set(...p.position);
  s.camera.lookAt(...p.target);
  s.camera.fov = s.head!.fov;
  s.camera.updateProjectionMatrix();
  s.render();
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
