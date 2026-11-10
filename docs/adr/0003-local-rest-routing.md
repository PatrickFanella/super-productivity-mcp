# ADR 0003: Route mapped actions to Local REST in the Go server

## Status

Accepted, November 10, 2026.

## Context

Until now every catalog action went through plugin IPC: the Go server wrote a
request file, and the Super Productivity plugin ran the action against
`PluginAPI`. Some operations have no `PluginAPI` equivalent on stock v20. True
archive and restore, for example, exist only as Local REST routes
(`POST /tasks/:id/archive`, `POST /tasks/:id/restore`).

The modular plugin bridge had a Local REST adapter, but it read its settings
from the plugin process's environment and used browser `fetch`. The packaged
`plugin.js` that users install had no adapter, so true archive never worked
for them. Putting the REST token into the plugin would also place a credential
in the app's renderer.

Stock v20 serves Local REST at `http://127.0.0.1:3876` with a Bearer token and
answers with `{ok, data}` or `{ok:false, error}`.

## Decision

The Go server talks to Local REST itself:

- `internal/localrest` owns HTTP delivery, envelope decoding and error
  classification.
- `internal/bridge` builds the `domain.Bridge` that both `sp-mcp` and
  `sp-quick-add` use. It sends each action in its route table to Local REST
  when `SP_LOCAL_REST_URL` is set, and every other action to plugin IPC.
- Plugin IPC remains the default. It is set up on first use, so a REST-routed
  action does not depend on the plugin's data directories.
- The route is chosen from configuration before anything is sent. A failed
  REST call is returned to the caller unchanged and never replayed through
  plugin IPC, because the first attempt may already have changed data.
- A failure before the request was written is reported as
  `LOCAL_REST_UNAVAILABLE` (retryable). A failure after a mutation was sent,
  such as a timeout, a 5xx or an unreadable answer, is `OUTCOME_UNKNOWN`.
- The token stays in the Go process. Requests use no proxy and follow no
  redirects, and no error message contains the token or a response body that
  is not an envelope.
- A host other than `127.0.0.1` or `localhost` needs
  `SP_LOCAL_REST_ALLOW_REMOTE=1`; without it, the dialer also refuses a
  `localhost` that resolves off the machine. A URL is used as written; a
  legacy prefix such as `/api` is not rewritten.
- Settings that are present but unusable make the REST-mapped actions fail
  with `LOCAL_REST_MISCONFIGURED`. They do not quietly fall back to plugin IPC.

Some routed actions have no supported plugin path on stock v20: recurrence
writes, for example, dispatch actions the app refuses. Those are marked as
needing REST and fail with `UNSUPPORTED_ACTION` before anything is sent when
REST is not configured. `SP_MCP_RECURRENCE_ROUTE=plugin` explicitly selects
the old plugin dispatch for app builds that allow it.

`task.archive` is the first routed action. Without Local REST it still goes to
the plugin, which only marks the task done when the caller passes
`allowDoneFallback:true`. Later changes add actions to the route table one at
a time, each with its own tests; the duplicate modular REST adapter is removed
as each of its operations moves.

## Consequences

- `domain.Bridge` now has two production adapters behind one interface. The
  interface stays `Call(ctx, req)`; routing lives in `internal/bridge`.
- The catalog stays the public contract. A REST-routed action keeps its tool
  name, arguments and result shape.
- Scope checks and argument validation still happen in the MCP adapter before
  the router sees a request.
- Packaged and modular plugin users get the same REST behavior, because
  neither plugin projection is involved.
- Fixture tests do not prove live behavior. Qualifying routed actions against
  a running app is a separate step (roadmap issue #30).

## Rejected alternatives

- Adding the token and `fetch` to the packaged plugin: puts a credential in the
  renderer and depends on the iframe's network permissions.
- Retrying a failed REST call through plugin IPC: can apply a change twice or
  hide which adapter changed data.
- A full proxy of the native app MCP: it covers active-task reads and Inbox
  capture only, not this suite's editing and scheduling tools.
