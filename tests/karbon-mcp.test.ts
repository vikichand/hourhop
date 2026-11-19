import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, codeFromRedirect, isOurRedirect, pkce, REDIRECT_URI, SCOPE, signInWithKarbon } from '../src/integrations/karbon-mcp';

type Call = { url: string; init: RequestInit; body: string };
type McpReply = (msg: { method: string; id: number; params: any }) => Response;

/** A fake identity.karbonhq.com + mcp.karbonhq.com shaped like Karbon's live discovery metadata. */
function fakeKarbon(opts: { sse?: boolean; pages?: number; tokenStatus?: number; grantedScope?: string; mcp?: McpReply; tools?: unknown[] } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const body = String(init.body ?? '');
    calls.push({ url, init, body });
    const u = new URL(url);
    const reply = (obj: unknown, headers: Record<string, string> = {}, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (u.pathname === '/mcp/oauth/register') return reply({ client_id: 'client-1', token_endpoint_auth_method: 'none' });
    if (u.pathname === '/connect/token') return opts.tokenStatus ? reply({ error: 'invalid_grant' }, {}, opts.tokenStatus) : reply({ access_token: 'tok-abc', scope: opts.grantedScope ?? 'mcp:public:read', token_type: 'Bearer' });
    if (u.href === 'https://mcp.karbonhq.com/mcp') {
      const msg = JSON.parse(body);
      if (msg.id === undefined) return new Response(null, { status: 202 });
      if (opts.mcp && msg.method === 'tools/list') return opts.mcp(msg);
      let result: unknown;
      if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', serverInfo: { name: 'karbon', version: '1.0' }, capabilities: { tools: {} } };
      if (msg.method === 'tools/list') {
        const page = Number(msg.params.cursor ?? 0);
        result = { tools: opts.tools ?? [{ name: `list_things_${page}`, description: 'Lists things', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }], ...(page + 1 < (opts.pages ?? 1) ? { nextCursor: String(page + 1) } : {}) };
      }
      const payload = { jsonrpc: '2.0', id: msg.id, result };
      if (opts.sse) return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sess-1' } });
      return reply(payload, { 'Mcp-Session-Id': 'sess-1' });
    }
    return new Response('', { status: 404 });
  };
  return { calls, fetchImpl };
}

/** Plays Karbon's login page: redirects back with a code and the state it was given. */
const approve = async (url: string) => `${REDIRECT_URI}?code=the-code&state=${new URL(url).searchParams.get('state')}`;
const run = (k: ReturnType<typeof fakeKarbon>) => signInWithKarbon({ now: () => 'NOW', fetchImpl: k.fetchImpl, capture: approve });

describe('Sign in with Karbon (OAuth 2.1 + PKCE, read-only)', () => {
  it('PKCE challenge is the S256 hash of the verifier; the authorize URL asks for read-only scope on Karbon\'s MCP resource', async () => {
    const { verifier, challenge } = await pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const u = new URL(authorizeUrl('client-1', challenge, 'st'));
    expect(u.origin + u.pathname).toBe('https://identity.karbonhq.com/connect/authorize');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'client-1', redirect_uri: 'http://127.0.0.1:53682/callback', scope: 'mcp:public:read',
      code_challenge_method: 'S256', resource: 'https://mcp.karbonhq.com/mcp', state: 'st',
    });
    expect(SCOPE).toBe('mcp:public:read');
  });

  it('accepts only the exact loopback redirect with this state; refuses a forged or error reply', () => {
    expect(isOurRedirect(`${REDIRECT_URI}?code=c&state=s`, 's')).toBe(true);
    expect(isOurRedirect(`${REDIRECT_URI}XYZ?code=c&state=s`, 's')).toBe(false);
    expect(isOurRedirect(`http://127.0.0.1:53682/other?code=c&state=s`, 's')).toBe(false);
    expect(isOurRedirect(`${REDIRECT_URI}?code=c&state=evil`, 's')).toBe(false);
    expect(isOurRedirect('not a url', 's')).toBe(false);
    expect(codeFromRedirect(`${REDIRECT_URI}?code=c&state=s`, 's')).toBe('c');
    expect(() => codeFromRedirect(`${REDIRECT_URI}?code=c&state=evil`, 's')).toThrow(/did not match/);
    expect(() => codeFromRedirect(`${REDIRECT_URI}?error=access_denied&state=s`, 's')).toThrow(/did not complete/);
  });

  it('registers, exchanges the code with the PKCE verifier and lists tools; calls no data tool and keeps no token', async () => {
    const k = fakeKarbon({ pages: 2 });
    const report = await run(k);
    expect(report).toMatchObject({ generatedUtc: 'NOW', grantedScope: 'mcp:public:read', server: { name: 'karbon', version: '1.0' } });
    expect(report.tools).toEqual([
      { name: 'list_things_0', description: 'Lists things', inputSchema: { type: 'object' }, readOnly: true },
      { name: 'list_things_1', description: 'Lists things', inputSchema: { type: 'object' }, readOnly: true },
    ]);
    expect(JSON.stringify(report)).not.toContain('tok-abc');

    expect(JSON.parse(k.calls[0]!.body)).toMatchObject({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' });
    const tok = new URLSearchParams(k.calls[1]!.body);
    expect(tok.get('grant_type')).toBe('authorization_code');
    expect(tok.get('code')).toBe('the-code');
    expect(tok.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const mcp = k.calls.filter((c) => c.url === 'https://mcp.karbonhq.com/mcp');
    expect(mcp.map((c) => JSON.parse(c.body).method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
    for (const c of mcp) expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-abc');
    expect((mcp[1]!.init.headers as Record<string, string>)['Mcp-Session-Id']).toBe('sess-1');
    for (const c of k.calls) {
      expect(c.init.method).toBe('POST');
      expect(c.init.credentials).toBe('omit');
      expect(c.url).not.toContain('tok-abc');
    }
  });

  it('reads server-sent event replies', async () => {
    expect((await run(fakeKarbon({ sse: true }))).tools).toHaveLength(1);
  });

  it('refuses a token that can write, and a refused sign-in never reaches the MCP server', async () => {
    const wide = fakeKarbon({ grantedScope: 'mcp:public:read mcp:public:write' });
    await expect(run(wide)).rejects.toThrow(/more access than/);
    expect(wide.calls.some((c) => c.url.startsWith('https://mcp.karbonhq.com'))).toBe(false);
    const refused = fakeKarbon({ tokenStatus: 400 });
    await expect(run(refused)).rejects.toThrow(/Karbon refused the sign-in/);
    expect(refused.calls.some((c) => c.url.startsWith('https://mcp.karbonhq.com'))).toBe(false);
  });

  it('hostile replies: wrong ids, junk events and non-JSON are unreadable; oversized tool lists are capped and trimmed', async () => {
    const sse = (s: string) => () => new Response(s, { headers: { 'Content-Type': 'text/event-stream' } });
    await expect(run(fakeKarbon({ mcp: sse('data: {"jsonrpc":"2.0","id":22,"result":{"tools":[]}}\n\n') }))).rejects.toThrow(/could not read/);
    await expect(run(fakeKarbon({ mcp: sse('data: not json\n\ndata: null\n\n') }))).rejects.toThrow(/could not read/);
    await expect(run(fakeKarbon({ mcp: (m) => new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: 'nope' } }), { headers: { 'Content-Type': 'application/json' } }) }))).rejects.toThrow(/could not read/);
    // A multi-line data field is one event; the matching id is chosen even after an unrelated one.
    const multi = sse(`data: {"jsonrpc":"2.0","id":99,"result":{}}\n\ndata: {"jsonrpc":"2.0","id":2,\ndata: "result":{"tools":[{"name":"ok"}]}}\n\n`);
    expect((await run(fakeKarbon({ mcp: multi }))).tools.map((t) => t.name)).toEqual(['ok']);

    const many = Array.from({ length: 300 }, (_, i) => ({ name: `t${i}`, description: 'x'.repeat(5000), inputSchema: { big: 'y'.repeat(30_000) } }));
    const r = await run(fakeKarbon({ tools: [null, { name: 42 }, ...many] }));
    expect(r.tools).toHaveLength(200);
    expect(r.tools[0]).toEqual({ name: 't0', description: 'x'.repeat(1000), inputSchema: undefined, readOnly: undefined, title: undefined });
  });
});
