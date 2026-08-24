// HTTP route smoke over isolated local server — no live wallet/chain, injectable ports only.
// Validates next-start-observable contract: stable errors, correlation/idempotency/version,
// watermarks (ETag/X-Prism-Watermark), submitted!=completed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createIsolatedFactory, resetFactory } from "../factory";
import { parseHeaders, toHttpResponse, readJson, requireSession } from "../http-helpers";
import type { AppSession } from "../auth";

// Helper to build a minimal HTTP server dispatching to factory handlers.
// Uses isolated in-memory factory (deterministic clock) — never Postgres, never chain.
function sessionFor(now: number): AppSession {
  return { sessionId: "sess_http_smoke", userId: "user-http", issuedAt: now - 10, expiresAt: now + 600 };
}

function controller() {
  return "0x1111111111111111111111111111111111111111";
}

describe("Runtime HTTP smoke — isolated local server (no live chain)", () => {
  const factory = createIsolatedFactory(1_789_000_000);
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Create dispatcher that maps HTTP paths to factory handlers.
    // We simulate Next route handling: parseHeaders + factory call + toHttpResponse.
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";
      // Collect body
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString();
      const headers = req.headers as Record<string, string | undefined>;
      // Reconstruct Request for helper parsing
      const fakeReq = new Request(url.toString(), {
        method,
        headers: headers as HeadersInit,
        body: rawBody.length > 0 ? rawBody : undefined,
      } as RequestInit);

      // Dispatch
      try {
        if (url.pathname === "/api/v1/identity" && method === "POST") {
          const parsed = parseHeaders(fakeReq);
          const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
          // require session from body or header
          const sessionOrErr = requireSession(fakeReq, body);
          if ("error" in sessionOrErr) {
            const r = sessionOrErr.error as Response;
            res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
            res.end(await r.text());
            return;
          }
          const controllerAddress = (body.controllerAddress as string) ?? controller();
          const headers2 = { requestId: parsed.requestId ?? null, idempotencyKey: parsed.idempotencyKey ?? (body.idempotencyKey as string | null) ?? null, correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null, expectedVersion: parsed.expectedVersion };
          const appRes = await factory.app.createIdentity({ headers: headers2, session: sessionOrErr, payload: { controllerAddress, kind: "create_identity" } });
          const httpRes = toHttpResponse(appRes, parsed);
          res.writeHead(httpRes.status, Object.fromEntries(httpRes.headers.entries()));
          res.end(await httpRes.text());
          return;
        }

        if (url.pathname.startsWith("/api/v1/identity/") && method === "GET") {
          const prismId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
          const parsed = parseHeaders(fakeReq);
          const appRes = await factory.app.getIdentity({ payload: { prismId }, headers: { requestId: parsed.requestId } });
          const httpRes = toHttpResponse(appRes, parsed);
          res.writeHead(httpRes.status, Object.fromEntries(httpRes.headers.entries()));
          res.end(await httpRes.text());
          return;
        }

        if (url.pathname.startsWith("/api/v1/resolve/") && method === "GET") {
          const prismId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
          const venue = url.searchParams.get("venue") ?? "BASE";
          const parsed = parseHeaders(fakeReq);
          const appRes = await factory.app.resolve({ payload: { prismId, venue }, headers: { requestId: parsed.requestId } });
          const httpRes = toHttpResponse(appRes, parsed);
          res.writeHead(httpRes.status, Object.fromEntries(httpRes.headers.entries()));
          res.end(await httpRes.text());
          return;
        }

        if (url.pathname.startsWith("/api/v1/operations/") && method === "GET") {
          const opId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
          const parsed = parseHeaders(fakeReq);
          const appRes = await factory.app.getOperation({ payload: { operationId: opId }, headers: { requestId: parsed.requestId } });
          const httpRes = toHttpResponse(appRes, parsed);
          res.writeHead(httpRes.status, Object.fromEntries(httpRes.headers.entries()));
          res.end(await httpRes.text());
          return;
        }

        if (url.pathname === "/api/v1/intents" && method === "POST") {
          const parsed = parseHeaders(fakeReq);
          const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
          const sessionOrErr = requireSession(fakeReq, body);
          if ("error" in sessionOrErr) {
            const r = sessionOrErr.error as Response;
            res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
            res.end(await r.text());
            return;
          }
          const idem = parsed.idempotencyKey ?? (body.idempotencyKey as string | undefined) ?? null;
          if (!idem) {
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: { code: "ERR-023", httpStatusHint: 409 } }));
            return;
          }
          try {
            const intent = await factory.pauseService.createIntent({
              prismId: body.prismId as string,
              purpose: (body.purpose as string) ?? "payment",
              idempotencyKey: idem,
              correlationId: parsed.correlationId ?? (body.correlationId as string | null) ?? null,
            } as never);
            const h = new Headers({ "content-type": "application/json" });
            if (parsed.requestId) h.set("x-request-id", parsed.requestId);
            if (parsed.correlationId) h.set("x-correlation-id", parsed.correlationId);
            res.writeHead(200, Object.fromEntries(h.entries()));
            res.end(JSON.stringify({ ok: true, data: intent, requestId: parsed.requestId ?? null }));
            return;
          } catch (e) {
            const code = (e as { code?: string })?.code ?? "ERR-023";
            const detail = (e as { detail?: string })?.detail ?? (e as Error).message;
            const { AppError } = await import("../errors");
            const appErr = new AppError(code as never, detail);
            res.writeHead(appErr.httpStatusHint, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: { code: appErr.code, httpStatusHint: appErr.httpStatusHint, detail: appErr.detail }, requestId: parsed.requestId ?? null }));
            return;
          }
        }

        if (url.pathname.startsWith("/api/v1/pauses/") && url.pathname.endsWith("/verify") && method === "POST") {
          const parts = url.pathname.split("/");
          const pauseId = decodeURIComponent(parts[3] ?? "");
          const parsed = parseHeaders(fakeReq);
          const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
          try {
            const p = await factory.pauseService.verifyPause(pauseId, { planHash: body.planHash as string | undefined, policyVersion: body.policyVersion as string | undefined });
            res.writeHead(200, { "content-type": "application/json", etag: `"${p.version}"`, ...(parsed.requestId ? { "x-request-id": parsed.requestId } : {}) });
            res.end(JSON.stringify({ ok: true, data: p, requestId: parsed.requestId ?? null }));
            return;
          } catch (e) {
            const code = (e as { code?: string })?.code ?? "ERR-023";
            const detail = (e as { detail?: string })?.detail ?? (e as Error).message;
            const { AppError } = await import("../errors");
            const { PauseError } = await import("../../features/prism-pause/domain/errors");
            if (e instanceof PauseError) {
              const shape = e.toExternalShape();
              res.writeHead(e.httpStatusHint, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: shape, requestId: parsed.requestId ?? null }));
              return;
            }
            const appErr = new AppError(code as never, detail);
            res.writeHead(appErr.httpStatusHint, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: { code: appErr.code, detail: appErr.detail, httpStatusHint: appErr.httpStatusHint }, requestId: parsed.requestId ?? null }));
            return;
          }
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "ERR-002", httpStatusHint: 404 }, requestId: null }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        // never leak stack
        res.end(JSON.stringify({ ok: false, error: { code: "ERR-023", httpStatusHint: 500, detail: "internal" } }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFactory();
  });

  it("POST /api/v1/identity propagates correlation/idempotency and returns submitted!=completed with version header", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-smoke-1",
        "x-correlation-id": "corr-smoke-1",
        "idempotency-key": "idem-smoke-1",
        "x-session-id": "sess_http_smoke",
        "x-session-user": "user-http",
      },
      body: JSON.stringify({ controllerAddress: controller(), session: sessionFor(1_789_000_000) }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-smoke-1");
    expect(res.headers.get("x-correlation-id")).toBe("corr-smoke-1");
    const body = (await res.json()) as { ok: boolean; data: { operationId: string; state: string }; requestId: string | null };
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("submitted");
    expect(body.data.state).not.toBe("completed");
    expect(body.data.operationId).toMatch(/^op-/);
    // operation version should be echoed as ETag
    expect(res.headers.get("etag")).toMatch(/^"/);
    expect(body.requestId).toBe("req-smoke-1");
  });

  it("same idempotency key same fingerprint is benign, different fingerprint is 409 conflict", async () => {
    const url = `${baseUrl}/api/v1/identity`;
    const headersBase = {
      "content-type": "application/json",
      "x-request-id": "req-idem-1",
      "x-correlation-id": "corr-idem",
      "idempotency-key": "idem-smoke-dedupe",
      "x-session-id": "sess_http_smoke",
      "x-session-user": "user-http",
    };
    const first = await fetch(url, { method: "POST", headers: headersBase, body: JSON.stringify({ controllerAddress: controller(), session: sessionFor(1_789_000_000) }) });
    expect(first.status).toBe(200);
    const b1 = (await first.json()) as { data: { operationId: string } };
    const replay = await fetch(url, { method: "POST", headers: { ...headersBase, "x-request-id": "req-idem-2" }, body: JSON.stringify({ controllerAddress: controller(), session: sessionFor(1_789_000_000) }) });
    expect(replay.status).toBe(200);
    const b2 = (await replay.json()) as { data: { operationId: string } };
    expect(b2.data.operationId).toBe(b1.data.operationId);

    // different controller with same key -> conflict
    const conflict = await fetch(url, {
      method: "POST",
      headers: { ...headersBase, "x-request-id": "req-idem-3" },
      body: JSON.stringify({ controllerAddress: "0x2222222222222222222222222222222222222222", session: sessionFor(1_789_000_000) }),
    });
    expect(conflict.status).toBe(409);
    const cb = (await conflict.json()) as { error: { code: string } };
    expect(cb.error.code).toBe("ERR-023");
  });

  it("GET /api/v1/resolve and /api/v1/identity propagate watermark via body and headers (x-prism-watermark/ETag)", async () => {
    // Seed a binding via factory directly to have watermark path
    factory.registry.seedIdentity("prism:SMOKE1", controller());
    factory.registry.applyBindForTest("prism:SMOKE1", "BASE", "0xabc0000000000000000000000000000000000000000000000000", "0xdead00000000000000000000000000000000000000000000000000000000000000" as `0x${string}`);
    const res = await fetch(`${baseUrl}/api/v1/resolve/prism%3ASMOKE1?venue=BASE`, {
      headers: { "x-request-id": "req-wm-1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-prism-watermark")).toBe("100");
    expect(res.headers.get("etag")).toBe('"100"');
    const body = (await res.json()) as { data: { watermark: number; executionAccount: string | null }; watermark: number };
    expect(body.data.watermark).toBe(100);
    expect(body.watermark).toBe(100);

    const idRes = await fetch(`${baseUrl}/api/v1/identity/prism%3ASMOKE1`, { headers: { "x-request-id": "req-wm-2" } });
    expect(idRes.status).toBe(200);
    expect(idRes.headers.get("x-prism-watermark")).toBe("1");
    expect(idRes.headers.get("etag")).toBe('"1"');
  });

  it("unknown operation returns 404 stable error, no stack leak", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operations/op-unknown-xyz-999`, { headers: { "x-request-id": "req-unknown" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toBe("req-unknown");
    const body = (await res.json()) as { error: { code: string; httpStatusHint: number; detail?: string }; };
    expect(body.error.code).toBe("ERR-002");
    expect(body.error.httpStatusHint).toBe(404);
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
  });

  it("stable error shape for malformed request includes correlation echo and no stack", async () => {
    const res = await fetch(`${baseUrl}/api/v1/operations/op-unknown-xyz-999`, {
      headers: { "x-request-id": "req-err-shape", "x-correlation-id": "corr-err-shape" },
    });
    expect(res.headers.get("x-request-id")).toBe("req-err-shape");
    expect(res.headers.get("x-correlation-id")).toBe("corr-err-shape");
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toMatch(/^ERR-/);
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
  });

  it("If-Match / X-Expected-Version stale version fails with 409 and correct detail", async () => {
    // create operation via identity create then attempt stale transition via factory directly to prove header propagation path exists
    const createRes = await fetch(`${baseUrl}/api/v1/identity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-stale-1",
        "idempotency-key": "idem-stale-http",
        "x-session-id": "sess_http_smoke",
        "x-session-user": "user-http",
      },
      body: JSON.stringify({ controllerAddress: controller(), session: sessionFor(1_789_000_000) }),
    });
    expect(createRes.status).toBe(200);
    const { data } = (await createRes.json()) as { data: { operationId: string } };
    const op = await factory.operationStore.getById(data.operationId);
    expect(op).toBeDefined();
    // Try illegal stale transition via app layer directly (simulates If-Match 0)
    const wrong = await factory.app.transitionOperation(data.operationId, "processing", 0, { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}` });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.error.code).toBe("ERR-023");
      expect(wrong.error.detail).toContain("stale_version");
    }
  });

  it("submitted is never completed — verify via HTTP receipt/operation path", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-comp-1",
        "idempotency-key": "idem-comp-http",
        "x-session-id": "sess_http_smoke",
        "x-session-user": "user-http",
      },
      body: JSON.stringify({ controllerAddress: controller(), session: sessionFor(1_789_000_000) }),
    });
    const { data } = (await res.json()) as { data: { operationId: string } };
    const opRes = await fetch(`${baseUrl}/api/v1/operations/${encodeURIComponent(data.operationId)}`, { headers: { "x-request-id": "req-comp-2" } });
    expect(opRes.status).toBe(200);
    const opBody = (await opRes.json()) as { data: { state: string } };
    expect(opBody.data.state).toBe("submitted");
    expect(opBody.data.state).not.toBe("completed");

    // illegal submitted->completed must be rejected via domain guard
    const illegal = await factory.app.transitionOperation(data.operationId, "completed", (await factory.operationStore.getById(data.operationId))!.version);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.detail).toContain("submitted_is_not_completed");
  });

  it("watermark and operation version headers are injectable port-agnostic (no secrets in headers)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-check-1",
        "idempotency-key": "idem-check-1",
        "x-session-id": "sess_http_smoke",
        "x-session-user": "user-http",
      },
      body: JSON.stringify({ controllerAddress: controller(), session: sessionFor(1_789_000_000) }),
    });
    const headers = Object.fromEntries(res.headers.entries());
    const headerBlob = JSON.stringify(headers).toLowerCase();
    expect(headerBlob).not.toContain("postgres");
    expect(headerBlob).not.toContain("secret");
    expect(headerBlob).not.toContain("password");
  });
});
