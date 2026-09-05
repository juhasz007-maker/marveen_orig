#!/usr/bin/env node
// PreToolUse hook: WebFetch egress allowlist enforcement.
//
// Any WebFetch call from the main agent must target a known, legitimate API
// endpoint. Arbitrary web content (RSS feeds, docs, news pages, public APIs
// not in the allowlist) MUST go through the quarantine-reader sub-agent
// instead, so the fetched content is quarantined, wrapped, and never executed
// as instructions in the main agent's context.
//
// Two-tier allowlist:
//   1. Built-in (ALLOWED_PREFIXES): hard-coded, always enforced.
//   2. Runtime (store/egress-allowlist.json): operator-managed, loaded on each
//      invocation. Shape: { "domains": ["example.com"], "prefixes": ["https://host/path/"] }
//      Both keys are optional. Missing file or malformed JSON -> treated as empty
//      lists (FAIL-OPEN on the file, FAIL-SAFE on the decision: the built-in list
//      still guards; no extra URLs are allowed merely because the file is missing).
//
// When a URL is not on either allowlist:
//   - The tool call is HARD-BLOCKED (decision: deny).
//   - The blocked call is appended to EGRESS_BLOCK_LOG for operator review.
//   - The operator can approve the URL/domain: add it to store/egress-allowlist.json,
//     then re-run the WebFetch. No restart required for THIS hook (it re-reads
//     the JSON on every invocation).
//   - GRANT LATENCY for the quarantine-reader (EGRESSRENDER824): the reader's
//     own prompt-level list is a RENDERED copy of this JSON, refreshed by a
//     file-watcher within ~5s of a JSON change and read at the reader's next
//     SPAWN. A denial from the reader's prompt copy produces NO line in the
//     block log below (it rejects without a network call) -- if a freshly
//     granted domain is still refused, wait a few seconds and spawn a new
//     reader; a session restart is NOT needed.
//
// The log is separate from the main Marveen log so operators can grep it
// independently: `tail -f store/egress-blocked.log`
//
// Scope: this guard covers the Claude Code WebFetch tool only. It does NOT
// intercept WebSearch, curl/Bash network calls, or MCP-server outbound
// requests. Those channels are out of scope for this hook mechanism and require
// separate controls if needed.

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Derive repo root from this script's location (scripts/hooks/egress-gate.mjs).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EGRESS_BLOCK_LOG = join(REPO_ROOT, 'store', 'egress-blocked.log')
const RUNTIME_ALLOWLIST_PATH = join(REPO_ROOT, 'store', 'egress-allowlist.json')

// Dashboard port: env WEB_PORT, else the install .env, else the 3420 default.
// A fixed 3420 in the allowlist below blocked the agent's own dashboard as soon
// as the install moved to another port.
// SECURITY: the value is interpolated into an allowlist PREFIX (`http://localhost:${PORT}/`), so it
// must be digits ONLY. An unvalidated value containing `@` turns the whole `localhost:<value>` part
// into a URL userinfo section -- `http://localhost:3420@evil.com/` resolves to host evil.com, which
// would put an attacker-chosen host on the built-in allowlist and defeat the egress gate entirely.
// Anything that is not 1-5 digits is rejected and falls back to the default port.
const isValidPort = (v) => /^\d{1,5}$/.test(v)
const DASHBOARD_PORT = (() => {
  const fromEnv = process.env['WEB_PORT']
  if (fromEnv && isValidPort(fromEnv)) return fromEnv
  try {
    const m = readFileSync(join(REPO_ROOT, '.env'), 'utf-8').match(/^WEB_PORT=(.*)$/m)
    const v = m?.[1]?.trim().replace(/^["']|["']$/g, '')
    if (v && isValidPort(v)) return v
  } catch { /* no .env: fall through to the default */ }
  return '3420'
})()

// Built-in allowlist: URL prefixes the main agent may call directly via WebFetch.
// Anything not on this list (or the runtime allowlist) must go through the
// quarantine-reader sub-agent. Keep sorted and documented so additions are
// intentional, not accidental.
const ALLOWED_PREFIXES = [
  // GitHub REST API
  'https://api.github.com/',
  // Google OAuth token endpoint
  'https://oauth2.googleapis.com/',
  // Google APIs (Calendar, Gmail, Drive, etc.)
  'https://www.googleapis.com/',
  'https://gmail.googleapis.com/',
  'https://calendar.googleapis.com/',
  // Telegram Bot API
  'https://api.telegram.org/',
  // Slack Web API
  'https://slack.com/api/',
  // Discord REST API
  'https://discord.com/api/',
  // Ollama (local LLM server) -- localhost and loopback
  'http://localhost:11434/',
  'http://127.0.0.1:11434/',
  // Marveen dashboard API (local). The port follows WEB_PORT: a fixed 3420 here
  // blocked the agent's own dashboard once the install moved to another port.
  `http://localhost:${DASHBOARD_PORT}/`,
  `http://127.0.0.1:${DASHBOARD_PORT}/`,
]

// The quarantine tier.
//
// The block message tells the caller to fetch through the quarantine-reader
// sub-agent -- and until now this same hook blocked that sub-agent too, so the
// escape hatch the gate prescribed was one the gate closed (kanban #224).
//
// A sub-agent's PreToolUse payload carries two fields a main agent's does not:
// `agent_id` and `agent_type` (measured 2026-08-03, both key sets recorded in
// store/egress-blocked.log). `agent_type` is what separates the tiers.
//
// FAIL-CLOSED: only an exact `agent_type` match opens this tier. A missing,
// empty, unknown or misspelled value is treated as a main agent, i.e. blocked.
// A mistake here can only deny a fetch, never grant one.
//
// The domain list mirrors the one in the sub-agent's own definition
// (templates/sub-agents/quarantine-reader.md). That copy is a promise the
// sub-agent makes to itself in its prompt; this one is enforcement. Keep them
// in step -- and when they disagree, this file is the one that decides.
const QUARANTINE_AGENT_TYPE = 'quarantine-reader'

// `path` (optional) narrows a domain to the URLs the sub-agent's definition
// actually promises. Reddit is the reason it exists: the definition allows RSS
// feeds only, and hostname matching alone would hand over the entire site.
const QUARANTINE_DOMAINS = [
  { domain: 'status.anthropic.com' },
  { domain: 'status.claude.com' },
  { domain: 'feeds.feedburner.com' },
  { domain: 'rss.arxiv.org' },
  { domain: 'export.arxiv.org' },
  { domain: 'hnrss.org' },
  { domain: 'feeds.arstechnica.com' },
  { domain: 'techcrunch.com' },
  { domain: 'feeds.reuters.com' },
  { domain: 'feeds.bbci.co.uk' },
  { domain: 'www.reddit.com', path: (p) => p.endsWith('.rss') },
]

// The reader's tier is a DENYLIST, not an allowlist. This is a proposal, not
// the implementation of a decision recorded here: the posture change needs the
// owner's sign-off before merge, and no code comment can stand in for it.
//
// Why the inversion is safe here and nowhere else: this tier is reachable only
// by a sub-agent whose definition grants it `tools: WebFetch` and nothing else.
// It has no shell, no filesystem, no store access -- it cannot read a token or
// a memory, so it has nothing to leak. What it returns is data the caller must
// wrap before use. The main agent's own WebFetch stays on the allowlist above:
// that is the path that could carry something out, and it is unchanged.
//
// Measured before the change: store/egress-blocked.log held 7 entries since
// 2026-08-14, every one of them a legitimate public read (mnb.hu, Claude docs,
// a Schueco product PDF, two company sites). Zero exfiltration attempts, seven
// stopped reads -- and that undercounts, because agents learn not to try.
//
// What the denylist must stop is NOT exfiltration but SSRF: a poisoned page
// talking the caller into aiming the reader at our own network. Hence the
// literal-address and internal-suffix rules below.
const QUARANTINE_DENY_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  '0.0.0.0',
  '::',
  '::1',
  '[::]',
  '[::1]',
  'metadata.google.internal',
  'instance-data',
])

const QUARANTINE_DENY_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan']

// Private / link-local / loopback IPv4 literals, plus the cloud metadata
// address (169.254.169.254 is inside the link-local range and thus covered).
function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((x) => Number(x) > 255)) return true // malformed -> deny
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

// IPv6 loopback / unique-local / link-local, with or without brackets.
function isPrivateIPv6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (!h.includes(':')) return false
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique-local
  if (h.startsWith('fe80')) return true // link-local
  // IPv4-mapped (::ffff:10.0.0.1) -- reuse the v4 rules on the tail.
  const tail = h.split(':').pop() ?? ''
  if (tail.includes('.')) return isPrivateIPv4(tail)
  return false
}

// KNOWN LIMIT, stated rather than papered over: this checks the hostname as
// written. A public name that RESOLVES to a private address (DNS rebinding)
// still passes, because the hook sees the URL, not the socket. Closing that
// needs resolution at fetch time, which is not this layer's job.
export function isQuarantineDenied(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return true // unparseable -> deny
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = parsed.hostname.toLowerCase()
  if (!host) return true
  if (QUARANTINE_DENY_HOSTS.has(host)) return true
  if (QUARANTINE_DENY_SUFFIXES.some((s) => host.endsWith(s))) return true
  if (isPrivateIPv4(host)) return true
  if (isPrivateIPv6(host)) return true
  return false
}

// Kept for the shipped feeds and operator additions: these stay allowed even
// if a future denylist entry would otherwise catch them, so the reader's
// long-standing sources cannot silently break.
function matchesQuarantineDomain(url, extraDomains = []) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const hostMatches = (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
  for (const entry of QUARANTINE_DOMAINS) {
    if (!hostMatches(entry.domain)) continue
    if (entry.path && !entry.path(parsed.pathname)) return false
    return true
  }
  // Operator additions carry no path rule: an entry someone typed into the
  // store file is a deliberate act, and second-guessing its shape here would
  // only make the file's behaviour harder to predict.
  return extraDomains.some(hostMatches)
}

// Load the runtime allowlist from store/egress-allowlist.json.
// FAIL-OPEN on the file: missing or malformed -> empty lists, NOT an error.
// The caller must still apply the built-in ALLOWED_PREFIXES.
export function loadRuntimeAllowlist() {
  try {
    const raw = readFileSync(RUNTIME_ALLOWLIST_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      domains: Array.isArray(parsed.domains) ? parsed.domains.filter((d) => typeof d === 'string') : [],
      prefixes: Array.isArray(parsed.prefixes) ? parsed.prefixes.filter((p) => typeof p === 'string') : [],
      // Operator-managed extension of the QUARANTINE tier. Reachable ONLY by
      // the quarantine-reader sub-agent -- putting a domain here does not open
      // it to the main agent, which is the whole point of the split.
      quarantineDomains: Array.isArray(parsed.quarantine_domains)
        ? parsed.quarantine_domains.filter((d) => typeof d === 'string')
        : [],
    }
  } catch {
    // Missing file or JSON parse error: treat as empty, never propagate.
    return { domains: [], prefixes: [], quarantineDomains: [] }
  }
}

// Pure decision, with the tier that decided it.
//
// `runtimeList` is the decoded store/egress-allowlist.json (or any equivalent
// object) and `agentType` is the payload's `agent_type` -- empty for a main
// agent. Keeping file I/O out of this function makes it fully unit-testable
// without touching the filesystem.
//
// The tier is returned because the quarantine tier is the security-relevant
// exception and its grants are audited: a fetch nobody can see is a hole
// nobody can find.
//
// Domain matching uses URL-parsed hostname ONLY, not string-contains, to prevent
// bypasses like `https://evil.com/?x=docs.anthropic.com` matching the domain
// "docs.anthropic.com" via a simple includes() check.
export function egressDecision(
  toolName,
  toolInput,
  runtimeList = { domains: [], prefixes: [], quarantineDomains: [] },
  agentType = '',
) {
  if (toolName !== 'WebFetch') return { blocked: false, tier: 'not-webfetch' }
  const url = String(toolInput?.url ?? '')
  if (!url) return { blocked: false, tier: 'no-url' }

  // 0. Reader denylist, BEFORE every allow path.
  //    Order matters and was found by a test, not by reading: the built-in
  //    prefixes include this install's own dashboard (http://localhost:PORT/),
  //    so with the denylist checked only in step 4 the reader would have
  //    reached localhost through step 1 -- the one address the denylist exists
  //    to refuse. An allowlist that predates the inversion must not be able to
  //    re-open what the inversion walls off, so for this agent type the deny
  //    rules are absolute.
  if (String(agentType ?? '') === QUARANTINE_AGENT_TYPE && isQuarantineDenied(url)) {
    return { blocked: true, tier: 'quarantine-denied' }
  }

  // 1. Built-in prefix check (startsWith is correct here: the prefix already
  //    includes the trailing slash so a prefix-extension attack is impossible,
  //    e.g. 'https://api.github.com.evil.com/' does not start with
  //    'https://api.github.com/').
  if (ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))) return { blocked: false, tier: 'builtin' }

  // 2. Runtime prefix check.
  const rtPrefixes = runtimeList.prefixes ?? []
  if (rtPrefixes.some((p) => url.startsWith(p))) return { blocked: false, tier: 'runtime-prefix' }

  // 3. Runtime domain check: parse the URL to extract a verified hostname.
  //    URL parsing fails on non-URLs -> block (fail-safe).
  const rtDomains = runtimeList.domains ?? []
  if (rtDomains.length > 0) {
    let hostname
    try {
      hostname = new URL(url).hostname
    } catch {
      // Unparseable URL: block, don't throw.
      return { blocked: true, tier: 'unparseable' }
    }
    // Match exact hostname OR any subdomain (host.endsWith('.' + domain)).
    if (rtDomains.some((d) => hostname === d || hostname.endsWith('.' + d))) return { blocked: false, tier: 'runtime-domain' }
  }

  // 4. Quarantine tier -- the ONLY tier a main agent cannot reach. Exact
  //    agent_type match required (fail-closed: anything else falls through to
  //    the block below).
  //
  //    Two sub-cases, in this order:
  //    (a) the shipped feeds and operator additions -- allowed as before, so a
  //        denylist change can never silently break a long-standing source;
  //    (b) anything else -- allowed UNLESS the denylist catches it. This is the
  //        inversion the owner approved: reading is open, and only our own
  //        network is walled off.
  if (String(agentType ?? '') === QUARANTINE_AGENT_TYPE) {
    if (matchesQuarantineDomain(url, runtimeList.quarantineDomains ?? [])) {
      return { blocked: false, tier: 'quarantine' }
    }
    if (!isQuarantineDenied(url)) {
      return { blocked: false, tier: 'quarantine-open' }
    }
    return { blocked: true, tier: 'quarantine-denied' }
  }

  return { blocked: true, tier: 'none' }
}

// Back-compatible boolean form.
export function isEgressBlocked(toolName, toolInput, runtimeList, agentType) {
  return egressDecision(toolName, toolInput, runtimeList, agentType).blocked
}

// The payload's top-level FIELD NAMES, sorted -- never a value.
//
// This exists to answer one open question with data instead of a guess: does
// the PreToolUse payload carry anything that identifies the CALLER? The gate
// decides on the URL alone, so a main agent and a quarantine-reader sub-agent
// are indistinguishable to it, and the sub-agent is the escape hatch the block
// message itself prescribes -- which is why the RSS path is currently dead
// (kanban #224). A caller-aware tier can only be built on a field that is
// verified to exist; building it on an assumed one would produce a guard that
// looks like it protects and does not.
//
// Keys only, by construction: a value could carry a url, a prompt, or a
// secret, and this log is read casually. Nested objects contribute nothing but
// their own key.
export function payloadKeySignature(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  return Object.keys(payload).sort().join(',')
}

// `agentType` IS logged by value, unlike everything else in the payload. It is
// an agent-type name from a fixed set -- not content, not a url, not a secret
// -- and without it a denied sub-agent call cannot be told apart from a denied
// main-agent one, which is exactly the distinction this log now exists to make.
function logLine(kind, url, detail, keys = '', agentType = '') {
  try {
    mkdirSync(join(REPO_ROOT, 'store'), { recursive: true })
    const ts = new Date().toISOString()
    const keyPart = keys ? ` payload_keys="${keys}"` : ''
    const agentPart = agentType ? ` agent_type="${agentType}"` : ''
    appendFileSync(EGRESS_BLOCK_LOG, `${ts} ${kind} url="${url}" ${detail}${agentPart}${keyPart}\n`, 'utf-8')
  } catch {
    // Never let log failure cascade into blocking the agent process itself.
  }
}

const BLOCK_MESSAGE =
  'Egress TILTOTT (egress-gate hook). Ez az URL nem szerepel a fő ágens WebFetch ' +
  'engedélylistáján. Külső web-tartalom (RSS, dokumentáció, cikkek, ismeretlen API-k) ' +
  'KIZÁRÓLAG a quarantine-reader sub-ágensen keresztül kérhető le: ' +
  'Agent({ subagent_type: "quarantine-reader", prompt: `FETCH {"url":"...","nonce":"..."}` }). ' +
  'A letiltott hívás rögzítve lett a store/egress-blocked.log fájlban. ' +
  'Ha ez a hívás jogos, az operátor jóváhagyhatja: adja hozzá az URL-t vagy domain-t a ' +
  'store/egress-allowlist.json fájlhoz ({ "domains": ["example.com"] } vagy ' +
  '{ "prefixes": ["https://example.com/api/"] }), majd futtassa újra a WebFetch hívást.'

function allow() { process.exit(0) }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }))
  process.exit(0)
}

function isInvokedDirectly() {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url))
    const entry = process.argv[1] ? realpathSync(process.argv[1]) : ''
    return self === entry
  } catch {
    return false
  }
}

if (isInvokedDirectly()) {
  let payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    allow() // malformed/empty input must never block the agent
  }
  const url = String(payload?.tool_input?.url ?? '')
  const agentType = String(payload?.agent_type ?? '')
  const runtimeList = loadRuntimeAllowlist()
  const decision = egressDecision(payload?.tool_name, payload?.tool_input, runtimeList, agentType)
  if (decision.blocked) {
    logLine('BLOCKED', url, 'reason="not on egress allowlist"', payloadKeySignature(payload), agentType)
    deny(BLOCK_MESSAGE)
  }
  // Audited, not silent: the quarantine tier is the one grant a main agent
  // cannot obtain, so every use of it leaves a line next to the denials. The
  // other tiers are the ordinary allowlist and stay quiet.
  if (decision.tier === 'quarantine') {
    logLine('ALLOWED_QUARANTINE', url, 'reason="quarantine-reader tier"', '', agentType)
  }
  allow()
}
