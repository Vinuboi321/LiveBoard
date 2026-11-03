// An in-memory stand-in for the parts of Supabase LiveBoard uses, wired into Playwright with page.route.
// push_rows follows the same rules as supabase/schema.sql (revision check, owner check, server sequence).
class FakeSupabase {
  constructor() { this.rows = { notes: new Map(), markers: new Map(), courses: new Map() }; this.profiles = new Map(); this.seq = 0; this.down = false; this.calls = []; }
  static session(uid) {
    const now = Math.floor(Date.now() / 1000);
    return { access_token: `tok-${uid}`, refresh_token: `ref-${uid}`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: uid, aud: "authenticated", role: "authenticated", email: `${uid.slice(-4)}@test.edu` } };
  }
  userOf(req) { const m = /Bearer tok-([\w-]+)/.exec(req.headers()["authorization"] || ""); return m ? m[1] : null; }
  all(kind, uid) { return [...this.rows[kind].values()].filter(r => r.user_id === uid); }
  pushRows(uid, kind, rows) {
    return rows.map(r => {
      const cur = this.rows[kind].get(r.id);
      if (cur && cur.user_id !== uid) return { id: r.id, status: "invalid" };
      if (!cur) { this.rows[kind].set(r.id, { id: r.id, user_id: uid, data: r.data, updated_at: r.updated_at, deleted: !!r.deleted, rev: 1, seq: ++this.seq }); return { id: r.id, status: "ok", rev: 1 }; }
      const base = typeof r.base_rev === "number" ? r.base_rev : null;
      if ((base !== null && cur.rev === base) || (base === null && r.updated_at > cur.updated_at)) {
        Object.assign(cur, { data: r.data, updated_at: r.updated_at, deleted: !!r.deleted, rev: cur.rev + 1, seq: ++this.seq });
        return { id: r.id, status: "ok", rev: cur.rev };
      }
      return { id: r.id, status: base === null ? "stale" : "conflict", rev: cur.rev, data: cur.data, deleted: cur.deleted };
    });
  }
  async attach(page) {
    await page.route("http://sb.test/**", async route => {
      const req = route.request(), url = new URL(req.url()), uid = this.userOf(req);
      this.calls.push(`${req.method()} ${url.pathname}`);
      if (this.down) return route.abort("internetdisconnected");
      if (url.pathname.startsWith("/auth/v1/")) return route.fulfill({ json: {} });
      if (!uid) return route.fulfill({ status: 401, json: { message: "JWT required" } });
      const json = (b, status = 200) => route.fulfill({ status, json: b, headers: { "content-type": "application/json" } });
      if (url.pathname === "/rest/v1/rpc/push_rows") {
        const { p_kind, p_rows } = JSON.parse(req.postData() || "{}");
        return json(this.pushRows(uid, p_kind, p_rows));
      }
      const kind = url.pathname.replace("/rest/v1/", "");
      if (kind === "profiles") {
        if (req.method() === "GET") return json(this.profiles.has(uid) ? [{ data: this.profiles.get(uid) }] : []);
        const body = JSON.parse(req.postData() || "{}");
        this.profiles.set(uid, (Array.isArray(body) ? body[0] : body).data);
        return route.fulfill({ status: 201, body: "" });
      }
      if (this.rows[kind] && req.method() === "GET") {
        const gt = Number((url.searchParams.get("seq") || "gt.0").replace("gt.", ""));
        const out = this.all(kind, uid).filter(r => r.seq > gt).sort((a, b) => a.seq - b.seq).slice(0, 500).map(r => ({ id: r.id, data: r.data, rev: r.rev, seq: r.seq, deleted: r.deleted }));
        return json(out);
      }
      return json({ message: "not faked: " + url.pathname }, 404);
    });
  }
}
module.exports = { FakeSupabase };
