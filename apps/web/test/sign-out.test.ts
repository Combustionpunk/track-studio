// One sign-out (#132): after ending the session here, the browser goes on to the forum's logout.
import { describe, expect, it, vi } from "vitest";
import { signOut } from "../src/lib/session.js";

describe("signOut", () => {
  it("ends the session, then sends the browser to the forum's logout", async () => {
    const post = vi.fn(async () => ({ ok: true, redirect: "http://forum.test/session/sso_provider?sso=abc&sig=def" }));
    const go = vi.fn();
    expect(await signOut(post, go)).toBe(true);
    expect(post).toHaveBeenCalledWith("/auth/logout");
    expect(go).toHaveBeenCalledWith("http://forum.test/session/sso_provider?sso=abc&sig=def");
  });

  it("stays on the page when forum login is off (dev login)", async () => {
    const go = vi.fn();
    expect(await signOut(async () => ({ ok: true, redirect: null }), go)).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });
});
