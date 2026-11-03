import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";

describe("GET /healthz", () => {
  it("is ok when the database answers", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("is 503 when the database doesn't (so compose marks the container unhealthy)", async () => {
    const { app } = await makeApp();
    app.db.close();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: "database" });
  });
});
