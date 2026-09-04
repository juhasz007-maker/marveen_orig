// The WebFetch egress gate: what it blocks, and what it now records about a
// block.
//
// The gate decides on the URL alone, so a main agent and a quarantine-reader
// sub-agent look identical to it -- which is why the sub-agent path the block
// message prescribes is itself blocked (kanban #224). Whether a caller-aware
// tier can be built at all depends on the PreToolUse payload carrying a field
// that identifies the caller, and that question is answered by recording the
// payload's FIELD NAMES on every block. Names only: this log is read casually
// and a value could be a url, a prompt or a secret.
//
// The gate is a .mjs hook script run by Claude Code, not application code. It
// guards its own entry point (isInvokedDirectly), so importing it here runs no
// side effects.
import { describe, it, expect } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { isEgressBlocked, egressDecision, payloadKeySignature } from '../../scripts/hooks/egress-gate.mjs'

const QUARANTINE = 'quarantine-reader'
const EMPTY = { domains: [], prefixes: [], quarantineDomains: [] }

describe('what the gate lets through', () => {
  it('passes a built-in allowed prefix', () => {
    expect(isEgressBlocked('WebFetch', { url: 'https://api.github.com/repos/a/b' })).toBe(false)
  })

  it('blocks arbitrary web content', () => {
    expect(isEgressBlocked('WebFetch', { url: 'https://hnrss.org/frontpage' })).toBe(true)
  })

  it('ignores every tool that is not WebFetch', () => {
    expect(isEgressBlocked('Bash', { command: 'curl https://hnrss.org/frontpage' })).toBe(false)
  })

  it('does not fall for a prefix-extension lookalike', () => {
    // 'https://api.github.com.evil.com/' does not start with the allowed
    // prefix, because the prefix carries its trailing slash.
    expect(isEgressBlocked('WebFetch', { url: 'https://api.github.com.evil.com/x' })).toBe(true)
  })

  it('matches a runtime domain on the hostname, not on the string', () => {
    const list = { domains: ['api.frankfurter.app'], prefixes: [] }
    expect(isEgressBlocked('WebFetch', { url: 'https://api.frankfurter.app/latest' }, list)).toBe(false)
    // The domain appearing in a query string must not open the gate.
    expect(isEgressBlocked('WebFetch', { url: 'https://evil.com/?x=api.frankfurter.app' }, list)).toBe(true)
  })

  it('allows a subdomain of a runtime domain', () => {
    const list = { domains: ['example.com'], prefixes: [] }
    expect(isEgressBlocked('WebFetch', { url: 'https://docs.example.com/x' }, list)).toBe(false)
  })

  it('blocks an unparseable url instead of throwing', () => {
    expect(isEgressBlocked('WebFetch', { url: 'not a url' }, { domains: ['example.com'], prefixes: [] })).toBe(true)
  })
})

// The tier that made the gate's own escape hatch usable. A sub-agent payload
// carries `agent_type`, a main agent's does not (measured 2026-08-03) -- that
// field, and nothing else, separates the two.
describe('the quarantine tier', () => {
  const feed = { url: 'https://techcrunch.com/feed/' }

  it('lets the quarantine-reader fetch a feed on its list', () => {
    expect(isEgressBlocked('WebFetch', feed, EMPTY, QUARANTINE)).toBe(false)
    expect(egressDecision('WebFetch', feed, EMPTY, QUARANTINE).tier).toBe('quarantine')
  })

  it('STILL blocks the same url for a main agent', () => {
    // The property the whole design rests on: opening the tier for the
    // sub-agent must not open it for everyone. A main agent fetching a news
    // feed puts unwrapped, untrusted text straight into its own context.
    expect(isEgressBlocked('WebFetch', feed, EMPTY, '')).toBe(true)
    expect(isEgressBlocked('WebFetch', feed, EMPTY, undefined)).toBe(true)
  })

  it('now LETS the reader fetch a public domain it was never given (2026-09-04 inversion)', () => {
    // This assertion used to read `toBe(true)`, and flipping it is the whole
    // point of the change, not an accident: the owner asked for open reading
    // after the block log showed seven stopped reads and zero exfiltration
    // attempts since 2026-08-14. The reader has `tools: WebFetch` and nothing
    // else -- no shell, no filesystem, no store -- so it holds no secret to
    // leak. What replaces the allowlist is the denylist below, and the main
    // agent's own path (the test above) is deliberately unchanged.
    expect(isEgressBlocked('WebFetch', { url: 'https://evil.example/feed' }, EMPTY, QUARANTINE)).toBe(false)
    expect(egressDecision('WebFetch', { url: 'https://evil.example/feed' }, EMPTY, QUARANTINE).tier).toBe('quarantine-open')
  })

  it('refuses our own network even for the reader, and does it BEFORE any allow path', () => {
    // Order is the substance here. The built-in prefixes include this install's
    // own dashboard, so a denylist consulted only at the quarantine step would
    // have let the reader reach localhost through the built-in tier -- the one
    // address the denylist exists to refuse. Found by a test, not by reading.
    const internal = [
      'http://localhost:3420/api/memories',
      'http://127.0.0.1:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.85.98:9000/',
      'http://192.168.1.1/',
      'http://172.20.0.5/',
      'http://100.100.0.1/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://printer.local/',
      'http://box.internal/',
      'http://metadata.google.internal/',
      'file:///etc/passwd',
    ]
    for (const url of internal) {
      expect(egressDecision('WebFetch', { url }, EMPTY, QUARANTINE).tier).toBe('quarantine-denied')
    }
    // ...and the neighbours of those ranges stay reachable, so the rule is a
    // rule and not a superstition about numbers that look private.
    for (const url of ['http://172.15.0.5/', 'http://172.32.0.5/', 'http://11.0.0.1/', 'http://100.63.0.1/']) {
      expect(isEgressBlocked('WebFetch', { url }, EMPTY, QUARANTINE)).toBe(false)
    }
  })

  it('keeps the denylist away from the main agent path', () => {
    // The main agent may still reach its own dashboard through the built-in
    // prefixes: the inversion narrows the reader, it does not widen or narrow
    // anyone else.
    expect(isEgressBlocked('WebFetch', { url: 'http://localhost:3420/api/memories' }, EMPTY, '')).toBe(false)
  })

  it('fails closed on anything that is not an exact agent_type match', () => {
    // A typo, a rename, a spoofed-looking value: all fall through to the
    // block. A mistake here can only deny a fetch, never grant one.
    for (const bad of ['quarantine_reader', 'Quarantine-Reader', 'quarantine-reader ', 'general-purpose', null, 42]) {
      expect(isEgressBlocked('WebFetch', feed, EMPTY, bad as never)).toBe(true)
    }
  })

  it('reddit: the RSS path still matches by name, and the rest is open like any public site', () => {
    // The path rule predates the inversion, when hostname-only matching would
    // have handed over the whole site while the definition promised feeds. It
    // is kept because the shipped sources must not depend on the new tier, but
    // it no longer decides anything: a non-RSS reddit URL is now reachable for
    // the same reason any other public URL is. Stated rather than left as a
    // surprise for whoever next reads the path callback and assumes it blocks.
    expect(egressDecision('WebFetch', { url: 'https://www.reddit.com/r/devops/new.rss' }, EMPTY, QUARANTINE).tier).toBe('quarantine')
    expect(egressDecision('WebFetch', { url: 'https://www.reddit.com/r/devops/about/rules.json' }, EMPTY, QUARANTINE).tier).toBe('quarantine-open')
  })

  it('inherits the ordinary allowlist rather than replacing it', () => {
    expect(isEgressBlocked('WebFetch', { url: 'https://api.github.com/x' }, EMPTY, QUARANTINE)).toBe(false)
  })

  it('takes operator additions from quarantine_domains -- for the sub-agent only', () => {
    const list = { domains: [], prefixes: [], quarantineDomains: ['feeds.example.org'] }
    expect(isEgressBlocked('WebFetch', { url: 'https://feeds.example.org/rss' }, list, QUARANTINE)).toBe(false)
    // Putting a domain in the quarantine list must not open it to a main agent.
    expect(isEgressBlocked('WebFetch', { url: 'https://feeds.example.org/rss' }, list, '')).toBe(true)
  })

  it('reports the tier so the grant can be audited', () => {
    // A fetch nobody can see is a hole nobody can find: the entry point logs
    // an ALLOWED_QUARANTINE line off this tier.
    expect(egressDecision('WebFetch', { url: 'https://api.github.com/x' }, EMPTY, QUARANTINE).tier).toBe('builtin')
    expect(egressDecision('WebFetch', feed, EMPTY, QUARANTINE).tier).toBe('quarantine')
    expect(egressDecision('WebFetch', feed, EMPTY, '').tier).toBe('none')
  })
})

describe('what a block records about the caller', () => {
  it('lists the payload field names, sorted', () => {
    const keys = payloadKeySignature({
      tool_name: 'WebFetch',
      session_id: 's1',
      cwd: '/home/x',
      tool_input: { url: 'https://hnrss.org/frontpage' },
    })
    expect(keys).toBe('cwd,session_id,tool_input,tool_name')
  })

  it('never records a value -- not from the top level, not from a nested object', () => {
    // The whole point: this line goes into a log an operator greps. A url, a
    // prompt or a token must not ride along with the diagnostic.
    const keys = payloadKeySignature({
      tool_name: 'WebFetch',
      tool_input: { url: 'https://secret.example/path?token=SHOULD-NOT-APPEAR' },
      transcript_path: '/home/viktor/.claude/projects/p/SHOULD-NOT-APPEAR.jsonl',
    })
    expect(keys).not.toContain('SHOULD-NOT-APPEAR')
    expect(keys).not.toContain('https://')
    expect(keys).toBe('tool_input,tool_name,transcript_path')
  })

  it('survives a payload that is not an object', () => {
    for (const bad of [null, undefined, 'string', 42, ['a']]) {
      expect(payloadKeySignature(bad as never)).toBe('')
    }
  })
})
