// Shared by the touch e2e specs (#16, #106): fingers on the screen through CDP, and where plan points and squares are.
import type { CDPSession, Page } from "@playwright/test";

export type XY = [number, number];

/** Fingers on the screen. `down` adds fingers, `move` moves all of them, `up` lifts them all. */
export class Touch {
  private pts: { x: number; y: number; id: number }[] = [];
  private next = 0;
  private moved = false;
  constructor(private cdp: CDPSession) {}
  static async on(page: Page) {
    return new Touch(await page.context().newCDPSession(page));
  }
  async down(...at: XY[]) {
    for (const [x, y] of at) {
      this.pts.push({ x, y, id: this.next++ });
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: this.pts.map((p) => ({ ...p })) });
    }
  }
  /** move every finger to these spots, in `steps` steps */
  async move(to: XY[], steps = 6) {
    this.moved = true;
    const from = this.pts.map((p) => [p.x, p.y]);
    for (let k = 1; k <= steps; k++) {
      this.pts.forEach((p, i) => {
        p.x = from[i][0] + ((to[i][0] - from[i][0]) * k) / steps;
        p.y = from[i][1] + ((to[i][1] - from[i][1]) * k) / steps;
      });
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: this.pts.map((p) => ({ ...p })) });
    }
  }
  /**
   * Lift every finger. After a drag the fingers rest a moment first, as a hand does: lifted mid-movement, Chromium's
   * emulation takes it as a fling and swallows the next tap (to stop the fling), whatever it lands on.
   */
  async up() {
    if (this.moved) {
      await new Promise((r) => setTimeout(r, 120));
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: this.pts.map((p) => ({ ...p })) });
    }
    this.moved = false;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    this.pts = [];
  }
  async tap(at: XY) {
    await this.down(at);
    await this.up();
  }
  /** one finger along a path of spots */
  async drag(path: XY[], steps = 4) {
    await this.down(path[0]);
    for (const p of path.slice(1)) await this.move([p], steps);
    await this.up();
  }
  async hold(at: XY, ms: number) {
    await this.down(at);
    await new Promise((r) => setTimeout(r, ms));
  }
}

/** screen position of a plan point (x, z) */
export const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => {
    const svg = document.querySelector("svg.plan-svg") as SVGSVGElement;
    const p = new DOMPoint(x, -z).matrixTransform(svg.getScreenCTM()!);
    return [p.x, p.y] as XY;
  }, [x, z] as XY);

/** screen centre of square [col, row] while laying */
export async function cell(page: Page, c: number, r: number): Promise<XY> {
  const g = await page.evaluate(() => {
    const h = document.querySelector("rect.lay-hit")!;
    return { x: +h.getAttribute("x")!, y: +h.getAttribute("y")!, h: +h.getAttribute("height")! };
  });
  const x = g.x + (c + 0.5) * 2, svgY = g.y + g.h - (r + 0.5) * 2;
  return screen(page, x, -svgY);
}
