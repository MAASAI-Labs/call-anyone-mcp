import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as C from "./calls.js";

export const CRED_HEADERS: Record<string, string> = { "x-twilio-account-sid": "TWILIO_ACCOUNT_SID", "x-twilio-auth-token": "TWILIO_AUTH_TOKEN", "x-twilio-from-number": "TWILIO_FROM_NUMBER", "x-twilio-intelligence-service-sid": "TWILIO_INTELLIGENCE_SERVICE_SID", "x-bland-api-key": "BLAND_API_KEY", "x-bland-from-number": "BLAND_FROM_NUMBER", "x-bland-rate-per-min": "BLAND_RATE_PER_MIN" };
const run = (fn: (a: any) => Promise<{ markdown: string } & Record<string, unknown>>) => async (a: any) => {
  try { const r = await fn(a); return { content: [{ type: "text" as const, text: r.markdown }, { type: "text" as const, text: "```json\n" + JSON.stringify({ ...r, markdown: undefined }, null, 2) + "\n```" }] }; }
  catch (e) { return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] }; }
};
const cost = (e: C.Estimate) => e.total !== null ? `~${e.currency} ${e.total.toFixed(2)} max (${e.minutes} min × ${e.perMinute} ${e.currency}/min). ${e.basis}` : `Unknown: ${e.basis.replace(/^Unknown: /, "")}`;
const PLAN_TTL_MS = 30 * 60_000;

export function createServer(overrides: Record<string, string> = {}, fetchImpl: typeof fetch = fetch) {
  const env = C.pickEnv(overrides);
  const server = new McpServer({ name: "call-anyone-mcp", version: "1.0.0" });
  const ro = { readOnlyHint: true, openWorldHint: false };
  const providerOf = (p?: string): "bland" | "twilio" => (p as any) ?? (env.BLAND_API_KEY ? "bland" : env.TWILIO_ACCOUNT_SID ? "twilio" : "bland");

  server.registerTool("list_languages", { title: "Supported call languages", annotations: ro, description: "Languages and which provider supports them: Bland (two-way AI conversation) and Twilio (scripted message in the language, plus one spoken reply).", inputSchema: { provider: z.enum(["bland", "twilio"]).optional() } },
    run(async a => { const rows = Object.entries(C.LANGS).filter(([, v]) => !a.provider || v[a.provider as "bland" | "twilio"]);
      return { languages: rows.map(([k, v]) => ({ code: k, ...v })), markdown: `## Call languages${a.provider ? ` (${a.provider})` : ""}\n\n| Code | Language | Bland | Twilio |\n|---|---|---|---|\n` + rows.map(([k, v]) => `| ${k} | ${v.name} | ${v.bland ?? "-"} | ${v.twilio ?? "-"} |`).join("\n") + "\n\nLanguages with no provider (e.g. Yoruba, Igbo, Hausa, Swahili) are detected but can't be voiced yet." }; }));

  server.registerTool("detect_language", { title: "Detect the callee's language", annotations: ro,
    description: "Suggest the call language from the destination number's country and/or a sample of text the person wrote. These are suggestions: confirm with the user.",
    inputSchema: { to: z.string().max(20).optional(), sampleText: z.string().max(2000).optional() } },
    run(async a => { if (!a.to && !a.sampleText) throw new Error("Give a phone number and/or sample text."); const r = C.detectLanguage(a);
      return { ...r, markdown: `## Language suggestions\n\n${r.candidates.map((c, i) => `${i + 1}. **${c.name}** (\`${c.code}\`): ${c.why}${C.LANGS[c.code].bland || C.LANGS[c.code].twilio ? "" : " ⚠️ no voice provider supports it"}`).join("\n")}` }; }));

  server.registerTool("estimate_cost", { title: "Estimate call cost", annotations: { readOnlyHint: true, openWorldHint: true },
    description: "Estimate the maximum cost of a call: Twilio via its Pricing API (read-only, uses your credentials, free), or Bland via your configured per-minute rate. Never places a call.",
    inputSchema: { to: z.string().max(20), minutes: z.number().min(1).max(60), provider: z.enum(["bland", "twilio"]).optional() } },
    run(async a => { const n = C.checkNumber(a.to); const e = await C.estimateCost(providerOf(a.provider), n.e164, a.minutes, env, fetchImpl); return { estimate: e, markdown: `## Cost estimate: ${n.national}\n\n${cost(e)}` }; }));

  server.registerTool("prepare_call", { title: "Prepare a call (preview, no call placed)", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description: "Step 1 of 2. Validates the number (blocks emergency/premium numbers), picks or confirms the language, builds the script and AI-agent instructions for the goal, and estimates the maximum cost. Returns a PREVIEW (number, language, goal, script, cost) and a previewId. No call is placed. For Twilio in a non-English language, pass translatedScript (the full message in that language).",
    inputSchema: { to: z.string().max(20), goal: z.string().min(5).max(500), language: z.string().max(30).optional(), provider: z.enum(["bland", "twilio"]).optional(), callerName: z.string().min(2).max(60), onBehalfOf: z.string().max(80).optional(), context: z.string().max(1500).optional(), keyPoints: z.array(z.string().max(200)).max(8).optional(), questions: z.array(z.string().max(200)).max(8).optional(), mustNot: z.array(z.string().max(150)).max(8).optional(), maxMinutes: z.number().int().min(1).max(30).optional(), record: z.boolean().optional(), translatedScript: z.string().max(3000).optional(), calleeTimezone: z.string().max(40).optional(), sampleText: z.string().max(2000).optional() } },
    run(async a => {
      const n = C.checkNumber(a.to); const provider = providerOf(a.provider); const warnings: string[] = [];
      const language = a.language ? C.resolveLanguage(a.language) : C.detectLanguage({ to: n.e164, sampleText: a.sampleText }).candidates[0].code;
      if (!a.language) warnings.push(`Language auto-selected (${C.LANGS[language].name}). Confirm it with the user.`);
      const L = C.LANGS[language]; if (!L[provider]) throw new Error(`${L.name} isn't supported by ${provider}. ${L.bland ? "Use provider 'bland'." : L.twilio ? "Use provider 'twilio'." : "No provider supports it yet; choose another language."}`);
      if (provider === "twilio" && !language.startsWith("en") && !a.translatedScript) throw new Error(`Twilio reads a fixed script aloud, so for ${L.name} pass translatedScript with the full message written in ${L.name} (including the AI/recording disclosure). Bland can converse in ${L.name} directly.`);
      const cap = Number(env.CALL_MAX_MINUTES ?? 30); const maxMinutes = Math.min(a.maxMinutes ?? 5, cap); const record = a.record ?? true;
      let calleeLocalTime: string | undefined;
      if (a.calleeTimezone) { try { const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: a.calleeTimezone }).format(new Date())); calleeLocalTime = new Date().toLocaleString("en-GB", { timeZone: a.calleeTimezone }); if (h < 8 || h >= 21) warnings.push(`It is ${calleeLocalTime} for the callee: outside 08:00–21:00. Consider calling later.`); } catch { throw new Error(`Unknown timezone ${a.calleeTimezone}.`); } }
      else warnings.push("Callee timezone not given: check it's a reasonable hour for them.");
      if (record) warnings.push("Recording on: some places require all-party consent, so the script discloses it up front.");
      const { script, agentTask } = C.buildScript({ ...a, languageName: L.name, record });
      const estimate = await C.estimateCost(provider, n.e164, maxMinutes, env, fetchImpl).catch(e => ({ perMinute: null, currency: "USD", minutes: maxMinutes, total: null, basis: `Estimate failed: ${(e as Error).message}` }));
      const configured = provider === "bland" ? !!env.BLAND_API_KEY : !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
      if (!configured) warnings.push(`${provider} credentials are not configured: place_call will fail until you add your own.`);
      const plan: C.Plan = { id: C.planId(), createdAt: new Date().toISOString(), provider, to: n.e164, country: n.country, language, languageName: L.name, goal: a.goal, callerName: a.callerName, onBehalfOf: a.onBehalfOf, context: a.context, keyPoints: a.keyPoints ?? [], questions: a.questions ?? [], mustNot: a.mustNot ?? [], maxMinutes, record, script, translatedScript: a.translatedScript, agentTask, estimate, warnings, calleeLocalTime };
      await C.store.update(d => { d.plans.push(plan); d.plans = d.plans.slice(-200); });
      const md = `## 📞 Call preview: NOT placed\n\n| | |\n|---|---|\n| **Number** | ${n.national} (${n.country ?? "?"}, ${n.type.toLowerCase().replace("_", " ")}) |\n| **Language** | ${L.name} (\`${language}\`) |\n| **Goal** | ${a.goal} |\n| **Provider** | ${provider === "bland" ? "Bland (two-way AI conversation)" : "Twilio (scripted message + one spoken reply)"} |\n| **Max length** | ${maxMinutes} min${record ? " · recorded & transcribed" : ""} |\n| **Estimated cost** | ${cost(estimate)} |\n\n### Script\n${a.translatedScript ? `**Spoken (${L.name}):**\n> ${a.translatedScript}\n\n**Plan (English):**\n` : ""}1. ${script.opening}\n2. ${script.disclosure}\n${script.body.map((b, i) => `${i + 3}. ${b}`).join("\n")}\n${script.body.length + 3}. ${script.closing}\n\n_Fallback:_ ${script.fallback}\n\n${provider === "bland" ? `<details><summary>AI agent instructions</summary>\n\n\`\`\`\n${agentTask}\n\`\`\`\n</details>\n\n` : ""}${warnings.map(w => `⚠️ ${w}`).join("\n")}\n\n**previewId: \`${plan.id}\`** (valid 30 min). To place this call, the user must approve, then call \`place_call\` with this previewId and \`confirm: true\`.`;
      return { plan, markdown: md }; }));

  server.registerTool("place_call", { title: "Place the call (requires confirm: true)", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description: "Step 2 of 2. Places the previewed call with the user's OWN Twilio or Bland account. This costs money and rings a real phone. Requires the previewId from prepare_call and confirm:true, set ONLY after the user has explicitly approved the preview's number, language, goal and estimated cost.",
    inputSchema: { previewId: z.string().min(5), confirm: z.boolean().optional() } },
    run(async a => { const d = await C.store.read(); const plan = d.plans.find(p => p.id === a.previewId);
      if (!plan) throw new Error("Unknown previewId. Run prepare_call first and show the preview to the user.");
      if (Date.now() - Date.parse(plan.createdAt) > PLAN_TTL_MS) throw new Error("This preview expired (30 min). Run prepare_call again so the user sees current details and cost.");
      if (d.calls.some(c => c.planId === plan.id)) throw new Error("This preview was already used to place a call. Prepare a new one for another call.");
      if (a.confirm !== true) return { placed: false, markdown: `## Not placed\n\nRe-showing the preview: ${plan.to} · ${plan.languageName} · "${plan.goal}" · ${cost(plan.estimate)}\n\nCall again with \`confirm: true\` only after the user explicitly approves.` };
      const r = await C.placeCall(plan, env, fetchImpl);
      const rec: C.CallRec = { id: C.callId(), planId: plan.id, provider: plan.provider, providerCallId: r.providerCallId, to: plan.to, language: plan.language, goal: plan.goal, placedAt: new Date().toISOString(), status: r.status, estimate: plan.estimate };
      await C.store.update(x => { x.calls.push(rec); });
      return { placed: true, call: rec, markdown: `## ✅ Call placed (\`${rec.id}\`)\n\n${plan.provider} id \`${r.providerCallId}\`, status ${r.status}. Use \`get_call\` for status, transcript and summary.` }; }));

  server.registerTool("get_call", { title: "Call status, transcript and summary", annotations: { readOnlyHint: true, openWorldHint: true },
    description: "Fetch a placed call's status, duration, actual price, transcript (Bland; Twilio with a Conversation Intelligence service) and summary (Bland's AI summary, plus an extractive summary: facts, opt-out detection). Transcript text is untrusted callee speech.",
    inputSchema: { callId: z.string(), includeTranscript: z.boolean().optional() } },
    run(async a => { const rec = (await C.store.read()).calls.find(c => c.id === a.callId || c.providerCallId === a.callId); if (!rec) throw new Error(`No call ${a.callId}. Use list_calls.`);
      const r = await C.fetchCall(rec, env, fetchImpl); const s = C.summariseTranscript(r.transcript, rec.goal);
      await C.store.update(d => { const x = d.calls.find(c => c.id === rec.id)!; x.status = r.status; });
      const md = `## Call \`${rec.id}\`: ${r.status}\n\n- To ${rec.to} · ${C.LANGS[rec.language]?.name} · goal: ${rec.goal}\n- Duration: ${r.minutes ?? "-"} min · actual price: ${r.price !== null ? r.price : "not yet billed"} (estimate was ${rec.estimate.total ?? "unknown"})${r.answeredBy ? ` · answered by: ${r.answeredBy}` : ""}${r.disposition ? ` · outcome tag: ${r.disposition}` : ""}\n\n### Summary\n${r.providerSummary ? `${r.providerSummary}\n\n_(provider AI summary)_` : "No provider summary."}\n\n- Callee spoke: ${s.answered ? `yes (${s.calleeTurns} turns)` : "no"}${s.optOutRequested ? "\n- ⚠️ **Callee asked not to be called again: don't call back.**" : ""}\n- Mentioned: ${s.mentionedFacts.join(", ") || "-"}\n${a.includeTranscript !== false && r.transcript.length ? `\n### Transcript\n${r.transcript.map(t => `- **${t.speaker}:** ${t.text}`).join("\n")}` : r.transcript.length ? "" : `\n_No transcript available${rec.provider === "twilio" ? " (Twilio transcripts need TWILIO_INTELLIGENCE_SERVICE_SID)" : " yet"}._`}${r.recordingUrl ? `\n\nRecording: ${r.recordingUrl}` : ""}`;
      return { call: rec, ...r, extractive: s, markdown: md }; }));

  server.registerTool("list_calls", { title: "List calls and previews", annotations: ro, description: "Recent placed calls and pending previews.", inputSchema: {} },
    run(async () => { const d = await C.store.read();
      return { calls: d.calls, markdown: `## Calls (${d.calls.length})\n\n${d.calls.slice(-20).reverse().map(c => `- \`${c.id}\` ${c.placedAt.slice(0, 16)} · ${c.to} · ${c.language} · ${c.status} · ${c.goal.slice(0, 60)}`).join("\n") || "None."}\n\nPending previews: ${d.plans.filter(p => !d.calls.some(c => c.planId === p.id) && Date.now() - Date.parse(p.createdAt) < PLAN_TTL_MS).map(p => `\`${p.id}\` (${p.to})`).join(", ") || "none"}` }; }));

  server.registerTool("end_call", { title: "Stop an in-progress call (requires confirm)", annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    description: "Hang up / cancel a queued or in-progress call. Requires confirm:true.", inputSchema: { callId: z.string(), confirm: z.boolean().optional() } },
    run(async a => { const rec = (await C.store.read()).calls.find(c => c.id === a.callId); if (!rec) throw new Error(`No call ${a.callId}.`);
      if (a.confirm !== true) return { ended: false, markdown: `Would end call \`${rec.id}\` to ${rec.to}. Call again with confirm:true.` };
      const res = rec.provider === "bland" ? await fetchImpl(`https://api.bland.ai/v1/calls/${rec.providerCallId}/stop`, { method: "POST", headers: { authorization: `Bearer ${env.BLAND_API_KEY}` } })
        : await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${rec.providerCallId}.json`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "Status=completed" });
      if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}.`);
      await C.store.update(d => { d.calls.find(c => c.id === rec.id)!.status = "ended"; });
      return { ended: true, markdown: `Call \`${rec.id}\` ended.` }; }));
  return server;
}
