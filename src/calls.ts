import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { franc } from "franc-min";
import { jsonStore, newId } from "./store.js";

export type Env = Record<string, string | undefined>;
export const VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_INTELLIGENCE_SERVICE_SID", "BLAND_API_KEY", "BLAND_FROM_NUMBER", "BLAND_RATE_PER_MIN", "CALL_MAX_MINUTES"] as const;
export const pickEnv = (o: Env): Env => Object.fromEntries(VARS.map(k => [k, o[k] ?? process.env[k]]));

/** Languages: BCP-47 code → name, and which provider supports it. Bland list from docs.bland.ai/api-v1/post/calls; Twilio <Say> uses Amazon Polly / Google voices by language. */
export const LANGS: Record<string, { name: string; bland?: string; twilio?: string }> = {
  "en-US": { name: "English (US)", bland: "en-US", twilio: "en-US" }, "en-GB": { name: "English (UK)", bland: "en-GB", twilio: "en-GB" }, "en-IN": { name: "English (India)", bland: "en-IN", twilio: "en-IN" }, "en-AU": { name: "English (Australia)", bland: "en-AU", twilio: "en-AU" },
  "es-ES": { name: "Spanish (Spain)", bland: "es", twilio: "es-ES" }, "es-MX": { name: "Spanish (Latin America)", bland: "es-419", twilio: "es-MX" }, "fr-FR": { name: "French", bland: "fr", twilio: "fr-FR" }, "fr-CA": { name: "French (Canada)", bland: "fr-CA", twilio: "fr-CA" },
  "de-DE": { name: "German", bland: "de", twilio: "de-DE" }, "it-IT": { name: "Italian", bland: "it", twilio: "it-IT" }, "pt-BR": { name: "Portuguese (Brazil)", bland: "pt-BR", twilio: "pt-BR" }, "pt-PT": { name: "Portuguese (Portugal)", bland: "pt-PT", twilio: "pt-PT" },
  "nl-NL": { name: "Dutch", bland: "nl", twilio: "nl-NL" }, "pl-PL": { name: "Polish", bland: "pl", twilio: "pl-PL" }, "ru-RU": { name: "Russian", bland: "ru", twilio: "ru-RU" }, "uk-UA": { name: "Ukrainian", bland: "uk", twilio: "uk-UA" },
  "tr-TR": { name: "Turkish", bland: "tr", twilio: "tr-TR" }, "sv-SE": { name: "Swedish", bland: "sv-SE", twilio: "sv-SE" }, "da-DK": { name: "Danish", bland: "da-DK", twilio: "da-DK" }, "nb-NO": { name: "Norwegian", bland: "no", twilio: "nb-NO" }, "fi-FI": { name: "Finnish", bland: "fi", twilio: "fi-FI" },
  "el-GR": { name: "Greek", bland: "el" }, "hu-HU": { name: "Hungarian", bland: "hu" }, "cs-CZ": { name: "Czech", bland: "cs", twilio: "cs-CZ" }, "ro-RO": { name: "Romanian", bland: "ro", twilio: "ro-RO" }, "sk-SK": { name: "Slovak", bland: "sk" }, "bg-BG": { name: "Bulgarian", bland: "bg" },
  "hi-IN": { name: "Hindi", bland: "hi", twilio: "hi-IN" }, "ja-JP": { name: "Japanese", bland: "ja", twilio: "ja-JP" }, "ko-KR": { name: "Korean", bland: "ko-KR", twilio: "ko-KR" }, "zh-CN": { name: "Chinese (Mandarin, Simplified)", bland: "zh-CN", twilio: "cmn-CN" }, "zh-TW": { name: "Chinese (Mandarin, Traditional)", bland: "zh-TW", twilio: "cmn-TW" },
  "vi-VN": { name: "Vietnamese", bland: "vi", twilio: "vi-VN" }, "id-ID": { name: "Indonesian", bland: "id", twilio: "id-ID" }, "ms-MY": { name: "Malay", bland: "ms" }, "ar-XA": { name: "Arabic", twilio: "arb" }, "he-IL": { name: "Hebrew", twilio: "he-IL" }, "th-TH": { name: "Thai", twilio: "th-TH" },
  "yo-NG": { name: "Yoruba" }, "ig-NG": { name: "Igbo" }, "ha-NG": { name: "Hausa" }, "sw-KE": { name: "Swahili" }, "am-ET": { name: "Amharic" }, "zu-ZA": { name: "Zulu" },
};
const FRANC: Record<string, string> = { eng: "en-US", spa: "es-ES", fra: "fr-FR", deu: "de-DE", ita: "it-IT", por: "pt-BR", nld: "nl-NL", pol: "pl-PL", rus: "ru-RU", ukr: "uk-UA", tur: "tr-TR", swe: "sv-SE", dan: "da-DK", nob: "nb-NO", fin: "fi-FI", ell: "el-GR", hun: "hu-HU", ces: "cs-CZ", ron: "ro-RO", slk: "sk-SK", bul: "bg-BG", hin: "hi-IN", jpn: "ja-JP", kor: "ko-KR", cmn: "zh-CN", vie: "vi-VN", ind: "id-ID", zlm: "ms-MY", arb: "ar-XA", heb: "he-IL", tha: "th-TH", yor: "yo-NG", ibo: "ig-NG", hau: "ha-NG", swh: "sw-KE", amh: "am-ET", zul: "zu-ZA" };
/** Country → likely languages (first = default). A guess only; the user should confirm. */
const COUNTRY: Record<string, string[]> = { US: ["en-US", "es-MX"], CA: ["en-US", "fr-CA"], GB: ["en-GB"], IE: ["en-GB"], AU: ["en-AU"], NZ: ["en-AU"], IN: ["hi-IN", "en-IN"], NG: ["en-GB", "yo-NG", "ig-NG", "ha-NG"], GH: ["en-GB"], KE: ["en-GB", "sw-KE"], ZA: ["en-GB", "zu-ZA"], ET: ["am-ET"], TZ: ["sw-KE"],
  ES: ["es-ES"], MX: ["es-MX"], AR: ["es-MX"], CO: ["es-MX"], CL: ["es-MX"], PE: ["es-MX"], FR: ["fr-FR"], BE: ["fr-FR", "nl-NL"], CH: ["de-DE", "fr-FR", "it-IT"], DE: ["de-DE"], AT: ["de-DE"], IT: ["it-IT"], BR: ["pt-BR"], PT: ["pt-PT"], NL: ["nl-NL"], PL: ["pl-PL"], RU: ["ru-RU"], UA: ["uk-UA"], TR: ["tr-TR"], SE: ["sv-SE"], DK: ["da-DK"], NO: ["nb-NO"], FI: ["fi-FI"], GR: ["el-GR"], HU: ["hu-HU"], CZ: ["cs-CZ"], RO: ["ro-RO"], SK: ["sk-SK"], BG: ["bg-BG"],
  JP: ["ja-JP"], KR: ["ko-KR"], CN: ["zh-CN"], TW: ["zh-TW"], HK: ["zh-TW", "en-GB"], VN: ["vi-VN"], ID: ["id-ID"], MY: ["ms-MY", "en-GB"], SG: ["en-GB", "zh-CN", "ms-MY"], SA: ["ar-XA"], AE: ["ar-XA", "en-GB"], EG: ["ar-XA"], MA: ["ar-XA", "fr-FR"], IL: ["he-IL"], TH: ["th-TH"], SN: ["fr-FR"], CI: ["fr-FR"], CM: ["fr-FR", "en-GB"] };

export function checkNumber(to: string) {
  const digits = to.replace(/[^\d]/g, "");
  if (/^(1?911|44?999|112|000|110|119|100|101|102|108|190|991|44?112)$/.test(digits)) throw new Error("Emergency numbers can't be called by this tool.");
  const p = parsePhoneNumberFromString(to);
  if (!p || !p.isValid()) throw new Error(`"${to}" isn't a valid phone number. Use international E.164 format, e.g. +2348031234567.`);
  const e164 = p.number as string; const nat = p.nationalNumber as string; const type = p.getType();
  if (/^(911|112|999|000|110|119|100|101|102|108|190|991)$/.test(nat) || ["+1911", "+44999", "+44112"].includes(e164)) throw new Error("Emergency numbers can't be called by this tool.");
  if (type === "PREMIUM_RATE" || type === "SHARED_COST" || (p.country === "US" && /^(900|976)/.test(nat))) throw new Error(`Refusing ${type ?? "premium"} number ${e164}: premium-rate/shared-cost numbers can incur high charges.`);
  return { e164, country: p.country ?? null, type: type ?? "UNKNOWN", national: p.formatInternational() };
}

export function detectLanguage(a: { to?: string; sampleText?: string }) {
  const out: { candidates: { code: string; name: string; why: string }[] } = { candidates: [] };
  if (a.sampleText && a.sampleText.trim().length >= 10) {
    const iso = franc(a.sampleText, { minLength: 10 }); const code = FRANC[iso];
    if (code) out.candidates.push({ code, name: LANGS[code].name, why: `Detected from the sample text (franc: ${iso})` });
  }
  if (a.to) { const n = checkNumber(a.to); for (const c of COUNTRY[n.country ?? ""] ?? []) if (!out.candidates.some(x => x.code === c)) out.candidates.push({ code: c, name: LANGS[c].name, why: `Common language for ${n.country} numbers (a guess: confirm with the user)` }); }
  if (!out.candidates.length) out.candidates.push({ code: "en-US", name: "English (US)", why: "Default; no signal" });
  return out;
}
export function resolveLanguage(code: string) {
  const k = Object.keys(LANGS).find(x => x.toLowerCase() === code.toLowerCase()) ?? Object.keys(LANGS).find(x => x.toLowerCase().startsWith(code.toLowerCase() + "-")) ?? Object.keys(LANGS).find(x => LANGS[x].name.toLowerCase().startsWith(code.toLowerCase()));
  if (!k) throw new Error(`Unknown language "${code}". Use list_languages.`); return k;
}

// ---------- script ----------
export interface Plan { id: string; createdAt: string; provider: "bland" | "twilio"; to: string; country: string | null; language: string; languageName: string; goal: string; callerName: string; onBehalfOf?: string; context?: string; keyPoints: string[]; questions: string[]; mustNot: string[]; maxMinutes: number; record: boolean; script: { opening: string; disclosure: string; body: string[]; closing: string; fallback: string }; translatedScript?: string; agentTask: string; estimate: Estimate; warnings: string[]; calleeLocalTime?: string }
export function buildScript(p: { goal: string; callerName: string; onBehalfOf?: string; context?: string; keyPoints?: string[]; questions?: string[]; mustNot?: string[]; languageName: string; record: boolean }) {
  const who = p.onBehalfOf ? `${p.callerName}, calling on behalf of ${p.onBehalfOf}` : p.callerName;
  const script = {
    opening: `Hello, this is ${who}.`,
    disclosure: `I'm an automated AI assistant${p.record ? ", and this call is recorded and transcribed" : ""}. Is now a good time for a quick call?`,
    body: [`The reason for my call: ${p.goal}.`, ...(p.keyPoints ?? []).map(k => `Mention: ${k}`), ...(p.questions ?? []).map(q => `Ask: ${q}`)],
    closing: "Thank you very much for your time. Goodbye.",
    fallback: "If they are busy, ask for a better time to call back. If they ask not to be called, apologise, confirm, and end the call.",
  };
  const agentTask = [`You are ${who}, making a phone call. Speak ONLY in ${p.languageName}, politely and concisely.`,
    `At the start, say who you are and that you are an AI assistant${p.record ? " and the call is recorded" : ""}.`,
    `Goal: ${p.goal}.`, p.context ? `Context: ${p.context}` : "", p.keyPoints?.length ? `Key points to cover: ${p.keyPoints.join("; ")}.` : "", p.questions?.length ? `Questions to get answered: ${p.questions.join("; ")}.` : "",
    `Never: ${["make payments or share card/bank details", "agree to anything binding beyond the goal", "claim to be human", "pressure the person", ...(p.mustNot ?? [])].join("; ")}.`,
    `If the person is busy, ask for a better time. If they ask not to be called again, apologise and end the call. If they don't speak ${p.languageName}, try English once, then politely end.`,
    "Before hanging up, briefly repeat back what was agreed or learned."].filter(Boolean).join("\n");
  return { script, agentTask };
}

// ---------- cost ----------
export interface Estimate { perMinute: number | null; currency: string; minutes: number; total: number | null; basis: string; source?: string }
export async function estimateCost(provider: "bland" | "twilio", to: string, minutes: number, env: Env, fetchImpl: typeof fetch = fetch): Promise<Estimate> {
  if (provider === "bland") {
    const r = env.BLAND_RATE_PER_MIN ? Number(env.BLAND_RATE_PER_MIN) : null;
    return { perMinute: r, currency: "USD", minutes, total: r !== null ? +(r * minutes).toFixed(2) : null, basis: r !== null ? "BLAND_RATE_PER_MIN (your plan's per-minute rate)" : "Unknown: set BLAND_RATE_PER_MIN to your plan's rate (see bland.ai pricing). International calls need prepaid credits.", source: "https://www.bland.ai/pricing" };
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return { perMinute: null, currency: "USD", minutes, total: null, basis: "Unknown: Twilio credentials needed to query the Pricing API (read-only, free)." };
  const u = `https://pricing.twilio.com/v2/Voice/Numbers/${encodeURIComponent(to)}${env.TWILIO_FROM_NUMBER ? `?OriginationNumber=${encodeURIComponent(env.TWILIO_FROM_NUMBER)}` : ""}`;
  const res = await fetchImpl(u, { headers: { authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64") }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { perMinute: null, currency: "USD", minutes, total: null, basis: `Twilio Pricing API returned HTTP ${res.status}.`, source: u };
  const j: any = await res.json(); const prices: number[] = (j.outbound_call_prices ?? []).map((x: any) => Number(x.current_price ?? x.base_price)).filter((n: number) => n >= 0);
  const per = prices.length ? Math.max(...prices) : null;
  return { perMinute: per, currency: (j.price_unit ?? "usd").toUpperCase(), minutes, total: per !== null ? +(per * minutes).toFixed(2) : null, basis: `Twilio Pricing API, ${j.country ?? ""} outbound (highest matching rate${prices.length > 1 ? " of " + prices.length : ""}); excludes recording/transcription/TTS fees.`, source: u };
}

// ---------- providers ----------
const twimlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function twiml(p: Plan, env: Env) {
  const lang = LANGS[p.language].twilio!; const say = (t: string) => `<Say language="${lang}">${twimlEsc(t)}</Say>`;
  const text = p.translatedScript ?? [p.script.opening, p.script.disclosure, ...p.script.body.map(b => b.replace(/^(Mention|Ask): /, "")), p.script.closing].join(" ");
  const tx = env.TWILIO_INTELLIGENCE_SERVICE_SID ? `<Start><Transcription languageCode="${lang}" intelligenceService="${twimlEsc(env.TWILIO_INTELLIGENCE_SERVICE_SID)}" track="both_tracks"/></Start>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${tx}${say(text)}<Gather input="speech" language="${lang}" speechTimeout="auto" timeout="8"/>${say(p.translatedScript ? "" : p.script.closing)}</Response>`.replace(`<Say language="${lang}"></Say>`, "");
}
export async function placeCall(p: Plan, env: Env, fetchImpl: typeof fetch = fetch): Promise<{ providerCallId: string; status: string }> {
  if (p.provider === "bland") {
    if (!env.BLAND_API_KEY) throw new Error("BLAND_API_KEY not set (use your own Bland account).");
    const body: Record<string, unknown> = { phone_number: p.to, task: p.agentTask, language: LANGS[p.language].bland, record: p.record, max_duration: p.maxMinutes, wait_for_greeting: false, voicemail: { action: "hangup" }, summary_prompt: `Summarise in 3 sentences in English: was the goal ("${p.goal}") achieved, what was agreed or learned, and any follow-up.`, metadata: { planId: p.id }, guard_rails: [{ type: "tcpa:ai_disclosure", actions: [{ type: "end_call" }], config: { end_seconds: 30 } }, { type: "tcpa:opt_out", actions: [{ type: "end_call" }] }] };
    if (env.BLAND_FROM_NUMBER) body.from = env.BLAND_FROM_NUMBER;
    const res = await fetchImpl("https://api.bland.ai/v1/calls", { method: "POST", headers: { authorization: `Bearer ${env.BLAND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j.status !== "success") throw new Error(`Bland refused the call: ${j.message ?? res.status}`);
    return { providerCallId: j.call_id, status: "queued" };
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) throw new Error("Twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (your own account and number).");
  const form = new URLSearchParams({ To: p.to, From: env.TWILIO_FROM_NUMBER, Twiml: twiml(p, env), TimeLimit: String(p.maxMinutes * 60), Record: String(p.record), MachineDetection: "Enable" });
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Calls.json`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: AbortSignal.timeout(20000) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio refused the call: ${j.message ?? res.status} (code ${j.code ?? "-"})`);
  return { providerCallId: j.sid, status: j.status };
}
export interface Turn { speaker: string; text: string; at?: string }
export async function fetchCall(rec: CallRec, env: Env, fetchImpl: typeof fetch = fetch) {
  if (rec.provider === "bland") {
    const res = await fetchImpl(`https://api.bland.ai/v1/calls/${encodeURIComponent(rec.providerCallId)}`, { headers: { authorization: `Bearer ${env.BLAND_API_KEY}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Bland HTTP ${res.status}`); const j: any = await res.json();
    return { status: j.status ?? (j.completed ? "completed" : "in-progress"), minutes: j.call_length ?? null, price: j.price ?? null, recordingUrl: j.recording_url ?? null, answeredBy: j.answered_by ?? null,
      transcript: (j.transcripts ?? []).map((t: any) => ({ speaker: t.user === "assistant" ? "agent" : t.user === "user" ? "callee" : t.user, text: t.text, at: t.created_at })) as Turn[], providerSummary: j.summary ?? null, disposition: j.disposition_tag ?? null };
  }
  const auth = "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${rec.providerCallId}.json`, { headers: { authorization: auth }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Twilio HTTP ${r.status}`); const c: any = await r.json();
  let transcript: Turn[] = [];
  if (env.TWILIO_INTELLIGENCE_SERVICE_SID) {
    const tl = await fetchImpl(`https://intelligence.twilio.com/v2/Transcripts?CallSid=${rec.providerCallId}`, { headers: { authorization: auth } });
    if (tl.ok) { const t: any = await tl.json(); const sid = t.transcripts?.[0]?.sid; if (sid) { const s = await fetchImpl(`https://intelligence.twilio.com/v2/Transcripts/${sid}/Sentences`, { headers: { authorization: auth } }); if (s.ok) transcript = ((await s.json()) as any).sentences?.map((x: any) => ({ speaker: x.media_channel === 1 ? "agent" : "callee", text: x.transcript, at: String(x.start_time) })) ?? []; } }
  }
  return { status: c.status, minutes: c.duration ? Math.ceil(Number(c.duration) / 60) : null, price: c.price ? Math.abs(Number(c.price)) : null, recordingUrl: null, answeredBy: c.answered_by ?? null, transcript, providerSummary: null, disposition: null };
}
/** Extractive fallback summary (no LLM): who said what, questions, numbers/dates/times mentioned, opt-out detection. */
export function summariseTranscript(t: Turn[], goal: string) {
  const callee = t.filter(x => x.speaker === "callee").map(x => x.text);
  const all = t.map(x => x.text).join(" ");
  const facts = [...new Set(all.match(/\b(\d{1,2}[:.]\d{2}\s?(am|pm)?|\d{1,2}\s?(am|pm)|\d+[\d,.]*\s?(%|dollars|euros|naira|pounds|usd|eur|ngn)?|(mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|today|tonight)\b/gi) ?? [])].slice(0, 12);
  const optOut = /(don'?t|do not|stop) (call|contact)|remove (me|my number)|not interested/i.test(callee.join(" "));
  return { turns: t.length, calleeTurns: callee.length, answered: callee.length > 0, optOutRequested: optOut, mentionedFacts: facts, lastCalleeLines: callee.slice(-3), goal, note: "Extractive summary; outcome judgement is left to the assistant/user." };
}
export interface CallRec { id: string; planId: string; provider: "bland" | "twilio"; providerCallId: string; to: string; language: string; goal: string; placedAt: string; status: string; estimate: Estimate }
export const store = jsonStore<{ plans: Plan[]; calls: CallRec[] }>("call-anyone-mcp", "calls.json", () => ({ plans: [], calls: [] }));
export const planId = () => newId("plan"); export const callId = () => newId("call");
