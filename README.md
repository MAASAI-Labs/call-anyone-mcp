# Call Anyone in Any Language MCP

**Live MCP URL (Streamable HTTP):** `https://call-anyone-mcp.vercel.app/mcp`  
Health check: `https://call-anyone-mcp.vercel.app/health`

Have your AI assistant make a phone call for you, in the callee's language, using **your own** [Bland](https://bland.ai) or [Twilio](https://twilio.com) account. The flow is:

1. Detect or choose the language.
2. State the goal; the server prepares the script.
3. **Preview the number, language, goal and estimated cost.**
4. You approve, and the assistant calls `place_call` with `confirm: true`.
5. Get the transcript and summary.

> **Safety:** `place_call` only works with a `previewId` from `prepare_call` **and** `confirm: true`. Previews are single-use and expire after 30 min. Other protections:
> - Emergency and premium-rate numbers are refused.
> - The script always discloses that the caller is an AI and, if recording, that the call is recorded.
> - Bland calls add the TCPA AI-disclosure and opt-out guard rails.
> - The agent is told never to pay, never to share financial details and never to claim to be human.
> - The preview warns when it's outside 08:00–21:00 for the callee, if you give their timezone.

## Tools
| Tool | Purpose | Spends money? |
|---|---|---|
| `list_languages` | Language codes and which provider supports each (Bland codes per docs.bland.ai) | No |
| `detect_language` | Suggests languages from the number's country and/or a text sample, using franc | No |
| `estimate_cost` | Twilio Pricing API (read-only), or your `BLAND_RATE_PER_MIN` | No |
| `prepare_call` | Validates the number, resolves the language, builds the script and AI-agent instructions, estimates max cost, returns a **preview + previewId** | No |
| `place_call` | Places the previewed call | **Yes, only with `confirm: true`** |
| `get_call` | Status, duration, actual price, transcript, provider summary plus an extractive summary (facts, opt-out detection) | No |
| `list_calls` | Recent calls and pending previews | No |
| `end_call` | Hang up or cancel | Requires `confirm: true` |

### Providers
- **Bland (recommended):** a true two-way AI conversation in the chosen language. Transcripts and summary come from `GET /v1/calls/{id}`.
- **Twilio:** speaks your script with `<Say language>`, then captures one spoken reply with `<Gather input="speech">`. It's a one-way message rather than a negotiation. For non-English languages you must pass `translatedScript`, the full text in that language (the assistant can write it). Transcripts need a Conversation Intelligence service (`TWILIO_INTELLIGENCE_SERVICE_SID`), which starts real-time `<Transcription>`. A fully conversational Twilio mode (ConversationRelay plus your LLM) would be a future addition.

## Credentials (yours; env or per-request headers)
| Env | Header | |
|---|---|---|
| `BLAND_API_KEY` | `x-bland-api-key` | Bland |
| `BLAND_FROM_NUMBER` | `x-bland-from-number` | optional caller ID |
| `BLAND_RATE_PER_MIN` | `x-bland-rate-per-min` | your plan's rate, used for estimates |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `x-twilio-*` | Twilio |
| `TWILIO_INTELLIGENCE_SERVICE_SID` | `x-twilio-intelligence-service-sid` | optional, for Twilio transcripts |
| `CALL_MAX_MINUTES` | | hard cap, default 30 |

## Example prompts
- "Call +34 612 345 678 in Spanish and book a table for two at 8pm Friday under Segun. Show me the preview first."
- "What language should I use for this number? They texted me 'Bonjour, vous êtes ouverts dimanche ?'"
- "How much would a 5-minute call to +2348031234567 cost?"
- "Get the transcript and summary of my last call."

## Run locally
```bash
npm install && npm run build
BLAND_API_KEY=... BLAND_RATE_PER_MIN=0.09 npm start   # http://localhost:3000/mcp
npm run start:stdio
npm test         # 10 tests; every provider is mocked; no calls, no spend
npm run smoke    # HTTP smoke with all credentials stripped; cannot place a call
```

## Deploy to Vercel
1. Import the repo; `/mcp` is preconfigured.
2. Don't set shared provider keys. Each user sends their own as headers.
3. Previews and call records are kept in a JSON file under `DATA_DIR`. On Vercel that's `/tmp`, which is ephemeral, and serverless instances don't share it. For hosting, use durable `DATA_DIR` or KV, or `place_call` may not find a preview made on another instance.

## Marketplace reviewer test
1. `npm test`: 10 pass. This covers number validation, language detection, the preview→confirm gate, single-use and expiring previews, mocked Bland and Twilio requests (body and TwiML checked), transcript and summary retrieval, and refusals.
2. `npm run smoke`: "all ok". Detect, list, prepare, confirm refused without credentials, emergency number refused.
3. To make one real call with your own account, run `prepare_call` and check the preview. Then run `place_call` with `confirm: true`, then `get_call`.

## Limitations
- Language detection from a number is only a guess, so confirm it with the callee.
- Some languages (Yoruba, Igbo, Hausa, Swahili, Amharic, Zulu) are detected but neither provider can voice them yet.
- Cost estimates exclude Twilio recording, transcription and TTS fees. The Bland estimate depends on the rate you set.
- Recording-consent laws vary. The script discloses recording up front, but compliance is your responsibility.

MIT License © 2026 Segun Cole


## Storage and tenant isolation

- **Hosted:** data is kept in a private **Vercel Blob** store (free Hobby quota) when `BLOB_READ_WRITE_TOKEN` is set, at `<app>/<tenant>/<file>.json`, with ETag-based optimistic concurrency.
- **Tenant key:** a one-way SHA-256 hash of the caller's own credential headers, or of an `x-user-key` header if you send one (recommended if your token rotates). Secrets are never stored and tenants can't see each other's data. Callers with no credentials and no `x-user-key` share a `public-demo` space, so don't put real data there.
- **Local / self-hosted:** without a Blob token it falls back to JSON files under `DATA_DIR` (default `~/.call-anyone-mcp/<tenant>/`).
