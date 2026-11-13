// One sign-out (#132): after ending the session here, the browser goes on to the forum's logout.
import { describe, expect, it, vi } from "vitest";
import { signOut, withoutNoSignin } from "../src/lib/session.js";

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

// A browser that keeps no cookies comes back from the silent check with ?nosignin=1 (#132); the page takes it off the address.
describe("withoutNoSignin", () => {
  it("removes the marker and keeps the rest of the query", () => {
    expect(withoutNoSignin("?nosignin=1")).toBe("");
    expect(withoutNoSignin("?sort=name&nosignin=1")).toBe("?sort=name");
    expect(withoutNoSignin("?nosignin=1&paper=a4&x=1")).toBe("?paper=a4&x=1");
  });

  it("leaves other addresses alone, byte for byte", () => {
    for (const s of ["", "?sort=name", "?q=a%20b&z=", "?nosignin2=1"]) expect(withoutNoSignin(s)).toBe(s);
  });
});
