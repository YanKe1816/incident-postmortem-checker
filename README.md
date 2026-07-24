# Incident Postmortem Checker

Incident Postmortem Checker is a read-only, stateless Cloudflare Workers MCP app. It extracts incident timelines and follow-up actions, and checks postmortem completeness using only text supplied in the request.

## Identity

- App Name: Incident Postmortem Checker
- App Slug: `incident-postmortem-checker`
- Cloudflare Worker Name: `incident-postmortem-checker`
- GitHub Repository: `https://github.com/YanKe1816/incident-postmortem-checker`
- Support Email: `sidcraigau@gmail.com`

Formal production URLs are recorded after Cloudflare deployment:

- Website URL: pending deployment
- MCP URL: pending deployment

Do not use temporary tunnel URLs as production URLs.

## Architecture

- Cloudflare Workers
- TypeScript
- JSON-RPC 2.0 MCP endpoint at `POST /mcp`
- No login, OAuth, database, external API, or external write behavior

## Public Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | Home page |
| GET | `/privacy` | Privacy Policy |
| GET | `/terms` | Terms of Service |
| GET | `/support` | Support |
| GET | `/health` | Machine-readable health status |
| GET | `/.well-known/openai-apps-challenge` | Temporary challenge value |
| POST | `/mcp` | MCP JSON-RPC endpoint |

The current challenge response is the temporary text value `test`. Replace it with the platform-provided token during formal platform submission; do not invent a production token.

## Frozen Tools

- `extract_incident_timeline`
- `extract_postmortem_actions`
- `check_postmortem_completeness`

Each tool exposes `inputSchema`, `outputSchema`, non-null annotations, and `structuredContent` results for both success and known tool errors.

## Runtime Strategy

Timeline extraction sorts events with reliable comparable timestamps chronologically. Explicit events without reliable timestamps are retained with `timestamp: ""` and preserve their original source order after sortable events. The tool does not invent missing timestamps.

Completeness evidence matching is conservative. Empty section headings such as `Impact:` or `Timeline:` are not evidence. Section body scanning stops at the next explicit section heading. `Follow-up actions with owners and deadlines` reuses the same explicit action-context rules as the action extraction tool, and is present only when the same reliable action record contains an action, an owner, and a due date.

Action extraction requires explicit action context. Bullet items under `Timeline`, `Incident timeline`, `Mitigation`, `Resolution`, `Impact`, `Root Cause`, or `Detection` are treated as incident facts, not follow-up actions. Incident fact sections take priority over future-task wording.

Out-of-scope detection is based on explicit command intent, not ordinary incident material. Requests that ask the tool to access systems, execute remediation, create tickets, notify people, infer unstated root cause, assign blame, or approve a postmortem return `out_of_scope`.

Unexpected internal exceptions are wrapped by the shared `executeWithInternalErrorBoundary` catch boundary. The formal HTTP MCP entrypoint does not expose any exception simulation parameter, header, environment variable, or other public trigger. Internal error behavior is verified by a non-HTTP unit test.

## Commands

```bash
npm install
npm run typecheck
npm run dev
npm run test:mcp:local
npm run test:internal
```

`npm run test:mcp:local` starts a local Worker with Wrangler and sends real HTTP requests through the public routes and `POST /mcp`.

`npm run test:internal` is a non-HTTP unit test for internal exception wrapping only.

## Deployment

```bash
npx wrangler whoami
npx wrangler deploy --dry-run
npx wrangler deploy
```

Use the URL returned by Wrangler as the formal Website URL. The formal MCP URL is that URL plus `/mcp`.

## Latest Local Test Results

```text
HTTP MCP Test Groups: 9
HTTP MCP Total Cases: 115
HTTP MCP Passed Cases: 115
HTTP MCP Failed Cases: 0

Internal Error Unit Cases: 3
Passed Cases: 3
Failed Cases: 0

Typecheck: PASS
```

## Boundaries

The app only analyzes content supplied in the current request. It does not access monitoring, logs, tickets, project management systems, or other external systems. It does not log in, use OAuth, use a database, call an external API, write to external systems, create tickets, send notifications, approve postmortems, or execute remediation.

Do not place real keys, challenge tokens, or credentials in this repository.
