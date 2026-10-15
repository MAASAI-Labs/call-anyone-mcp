import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import os from "node:os"; import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import * as C from "../src/calls.js";

let calls: { url: string; method: string; body?: string }[] = [];
const mock = (async (url: string, init: any = {}) => {
  calls.push({ url, method: init.method ?? "GET", body: init.body });
  const j = url.startsWith("https://pricing.twilio.com") ? { country: "Nigeria", price_unit: "USD", outbound_call_prices: [{ base_price: "0.2", current_price: "0.18", origination_prefixes: ["ALL"] }] }
    : url === "https://api.bland.ai/v1/calls" ? { status: "success", call_id: "bl-123" }
    : url.startsWith("https://api.bland.ai/v1/calls/bl-123") ? { status: "completed", completed: true, call_length: 2.4, price: 0.22, summary: "Table for two booked at 8pm Friday.", transcripts: [{ user: "assistant", text: "Hola, soy Ana, asistente de IA..." }, { user: "user", text: "Sí, tenemos mesa a las 8:00 pm el viernes." }] }
    : url.endsWith("/Calls.json") ? { sid: "CA999", status: "queued" } : {};
  return new Response(JSON.stringify(j), { status: 200 });
}) as unknown as typeof fetch;
async function client(creds: Record<string, string>) { const [a, b] = InMemoryTransport.createLinkedPair(); await createServer(creds, mock).connect(a); const c = new Client({ name: "t", version: "1" }); await c.connect(b); return c; }
const txt = (r: any) => r.content[0].text as string;
const json = (r: any) => JSON.parse(r.content[1].text.replace(/^```json\n|\n```$/g, ""));
const BLAND = { BLAND_API_KEY: "bk", BLAND_RATE_PER_MIN: "0.09" };
const TW = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15005550006" };
beforeEach(() => { calls = []; process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ca-")); for (const k of C.VARS) delete process.env[k]; });

describe("numbers & languages", () => {
  it("validates E.164 and blocks emergency/premium", () => {
    expect(C.checkNumber("+2348031234567").country).toBe("NG");
    expect(() => C.checkNumber("12345")).toThrow(/valid/); expect(() => C.checkNumber("+19005551234")).toThrow(/premium|Refusing/i);
  });
  it("detects language from text and country", () => {
    expect(C.detectLanguage({ sampleText: "Bonjour, je voudrais réserver une table pour ce soir, s'il vous plaît" }).candidates[0].code).toBe("fr-FR");
    expect(C.detectLanguage({ to: "+34612345678" }).candidates[0].code).toBe("es-ES");
    expect(C.resolveLanguage("spanish")).toBe("es-ES"); expect(C.resolveLanguage("ja")).toBe("ja-JP");
  });
});

describe("prepare → place flow (all mocked; no real calls)", () => {
  it("prepare returns a preview with number, language, goal and cost and places nothing", async () => {
    const c = await client(BLAND);
    const r = await c.callTool({ name: "prepare_call", arguments: { to: "+34612345678", goal: "Book a table for two at 8pm on Friday", language: "es", callerName: "Ana", onBehalfOf: "Segun", calleeTimezone: "Europe/Madrid" } });
    const t = txt(r); expect(t).toMatch(/NOT placed/); expect(t).toMatch(/\+34 612/); expect(t).toMatch(/Spanish/); expect(t).toMatch(/Book a table/); expect(t).toMatch(/USD 0\.45/);
    expect(json(r).plan.agentTask).toMatch(/Speak ONLY in Spanish/); expect(json(r).plan.agentTask).toMatch(/AI assistant/);
    expect(calls.filter(x => x.method === "POST")).toHaveLength(0);
  });
  it("place_call without confirm does nothing; with confirm calls Bland once; preview is single-use", async () => {
    const c = await client(BLAND);
    const id = json(await c.callTool({ name: "prepare_call", arguments: { to: "+34612345678", goal: "Book a table for two", language: "es-ES", callerName: "Ana" } })).plan.id;
    expect(txt(await c.callTool({ name: "place_call", arguments: { previewId: id } }))).toMatch(/Not placed/); expect(calls).toHaveLength(0);
    expect(txt(await c.callTool({ name: "place_call", arguments: { previewId: id, confirm: true } }))).toMatch(/bl-123/);
    const post = calls.find(x => x.url === "https://api.bland.ai/v1/calls")!; const b = JSON.parse(post.body!);
    expect(b).toMatchObject({ phone_number: "+34612345678", language: "es", max_duration: 5, record: true }); expect(b.guard_rails.length).toBe(2);
    expect((await c.callTool({ name: "place_call", arguments: { previewId: id, confirm: true } }) as any).isError).toBe(true);
    expect(calls.filter(x => x.url === "https://api.bland.ai/v1/calls")).toHaveLength(1);
  });
  it("rejects unknown/expired previews", async () => {
    const c = await client(BLAND); expect((await c.callTool({ name: "place_call", arguments: { previewId: "plan_nope", confirm: true } }) as any).isError).toBe(true);
    const id = json(await c.callTool({ name: "prepare_call", arguments: { to: "+34612345678", goal: "Book a table", language: "es", callerName: "Ana" } })).plan.id;
    await C.store.update(d => { d.plans[0].createdAt = new Date(Date.now() - 31 * 60_000).toISOString(); });
    expect(txt(await c.callTool({ name: "place_call", arguments: { previewId: id, confirm: true } }))).toMatch(/expired/); expect(calls.filter(x => x.method === "POST")).toHaveLength(0);
  });
  it("get_call returns transcript and summary", async () => {
    const c = await client(BLAND);
    const id = json(await c.callTool({ name: "prepare_call", arguments: { to: "+34612345678", goal: "Book a table", language: "es", callerName: "Ana" } })).plan.id;
    const callId = json(await c.callTool({ name: "place_call", arguments: { previewId: id, confirm: true } })).call.id;
    const t = txt(await c.callTool({ name: "get_call", arguments: { callId } }));
    expect(t).toMatch(/Table for two booked/); expect(t).toMatch(/\*\*callee:\*\* Sí, tenemos mesa/); expect(t).toMatch(/8:00 pm/);
  });
  it("Twilio: Pricing API estimate, needs translatedScript for non-English, sends TwiML Say with language", async () => {
    const c = await client(TW);
    expect(txt(await c.callTool({ name: "prepare_call", arguments: { to: "+33612345678", goal: "Confirm appointment", language: "fr", callerName: "Ana", provider: "twilio" } }) as any)).toMatch(/translatedScript/);
    const r = json(await c.callTool({ name: "prepare_call", arguments: { to: "+2348031234567", goal: "Remind about the meeting tomorrow at 10am", language: "en-GB", callerName: "Ana", provider: "twilio", maxMinutes: 2 } }));
    expect(r.plan.estimate).toMatchObject({ perMinute: 0.18, total: 0.36 });
    await c.callTool({ name: "place_call", arguments: { previewId: r.plan.id, confirm: true } });
    const post = calls.find(x => x.url.endsWith("/Calls.json"))!; const f = new URLSearchParams(post.body!);
    expect(f.get("To")).toBe("+2348031234567"); expect(f.get("TimeLimit")).toBe("120"); expect(f.get("Twiml")).toMatch(/<Say language="en-GB">Hello, this is Ana\./);
  });
  it("missing credentials: preview warns, place fails cleanly, nothing sent", async () => {
    const c = await client({});
    const r = json(await c.callTool({ name: "prepare_call", arguments: { to: "+14155550123", goal: "Ask opening hours", callerName: "Ana", language: "en-US" } }));
    expect(r.plan.warnings.join(" ")).toMatch(/not configured/);
    expect((await c.callTool({ name: "place_call", arguments: { previewId: r.plan.id, confirm: true } }) as any).isError).toBe(true); expect(calls).toHaveLength(0);
  });
  it("unsupported language/provider combos are refused", async () => { const c = await client(BLAND); expect(txt(await c.callTool({ name: "prepare_call", arguments: { to: "+2348031234567", goal: "Say hello", language: "yo-NG", callerName: "Ana" } }) as any)).toMatch(/No provider supports/); });
  it("extractive summary flags opt-out", () => { expect(C.summariseTranscript([{ speaker: "callee", text: "Please don't call me again" }], "x").optOutRequested).toBe(true); });
});
