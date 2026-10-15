// Safe smoke over HTTP: ALL provider credentials are stripped, so no call can be placed and nothing is billed.
// Exercises language detection, preview, cost (unknown without creds) and the confirm gate. Usage: npm run build && npm run smoke
import { spawn } from "node:child_process"; import { mkdtempSync } from "node:fs"; import os from "node:os"; import path from "node:path";
const env = { ...process.env }; for (const k of Object.keys(env)) if (/TWILIO|BLAND|CALL_MAX/.test(k)) delete env[k];
const port = 4300 + Math.floor(Math.random() * 50);
const srv = spawn("node", ["dist/main-http.js"], { env: { ...env, PORT: String(port), DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "ca-smoke-")) }, stdio: "inherit" });
await new Promise(r => setTimeout(r, 900));
let id = 0; const call = async (name, args) => (await (await fetch(`http://localhost:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
let fail = 0; const show = (n, r, err = false) => { const ok = !!r.isError === err; if (!ok) fail++; console.log(`\n== ${n} ${ok ? "ok" : "UNEXPECTED"}\n${r.content[0].text.slice(0, 1400)}`); return r; };
show("detect_language", await call("detect_language", { to: "+33612345678", sampleText: "Bonjour, est-ce que vous êtes ouverts dimanche ?" }));
show("list_languages bland", await call("list_languages", { provider: "bland" }));
const p = show("prepare_call", await call("prepare_call", { to: "+33612345678", goal: "Ask whether the bakery is open on Sunday and until what time", language: "fr", callerName: "Ana", onBehalfOf: "Segun", calleeTimezone: "Europe/Paris", provider: "bland" }));
const pid = JSON.parse(p.content[1].text.replace(/^```json\n|\n```$/g, "")).plan.id;
show("place_call (no confirm)", await call("place_call", { previewId: pid }));
show("place_call confirm, no creds → error", await call("place_call", { previewId: pid, confirm: true }), true);
show("prepare_call emergency → refused", await call("prepare_call", { to: "+1911", goal: "test call", callerName: "Ana" }), true);
srv.kill(); console.log(`\n${fail ? "FAILED " + fail : "all ok"}`); process.exit(fail ? 1 : 0);
