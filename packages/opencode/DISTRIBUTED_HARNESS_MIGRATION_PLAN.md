# Distributed harness migration plan

Practical phased split of the OpenCode harness into four independently scalable services.

## Goal

Split the current harness into:

- Sandboxing
- Session Management
- Tools and MCP Management
- Main Harness

Keep the current resource-oriented API surface, distributed tracing, and session history/replay behavior intact.

Current baseline:

- Session, MCP, sync, PTY, file, provider, and orchestration routes live in one runtime.
- Sync already models append-only replay.
- Workspace restore already replays session event batches locally or over HTTP.

## Decisions

- Preserve the existing resource tree and sub-resources; move ownership behind service boundaries.
- Use Main Harness as the public ingress and orchestration layer.
- Make Session Management the system of record for session state and history.
- Make Sandboxing the only service allowed to mutate execution or workspace state.
- Make Tools and MCP Management the only service allowed to manage tool and MCP lifecycle.
- Propagate trace context across every service boundary.

## Non-goals

- Do not redesign the public API beyond what is needed to split ownership.
- Do not replace the current event model.
- Do not force every request through async messaging.

## Constraints

- Keep session, history, and replay ordered by session aggregate.
- Keep sandbox operations isolated per workspace or execution target.
- Avoid shared writable databases across services.
- Keep compatibility shims for existing routes until clients move.

## Service map

- Sandboxing: workspace lifecycle, PTY and process execution, filesystem mutation, snapshots, restore targets, execution telemetry.
- Session Management: session CRUD, status, summaries, todos, compaction, message history, append-only event log, replay snapshots.
- Tools and MCP Management: tool catalog, command registry, MCP server lifecycle, OAuth flows, tool auth, tool execution brokering.
- Main Harness: request ingress, model and agent orchestration, public API composition, streaming responses, cross-service fanout, auth and session bootstrap.

Each service scales on its own:

- Sandboxing by execution concurrency and workspace count.
- Session Management by session write and read load, plus retention.
- Tools and MCP Management by active server connections and tool-call fanout.
- Main Harness by inbound request rate and streaming sessions.

## API surface

- Keep resource-style session endpoints intact.
- Preserve nested sub-resources for list, item, status, history, replay, and similar session views.
- Keep `/mcp` as the public resource group for MCP lifecycle and auth.
- Keep `/sync/history` and `/sync/replay` as compatibility paths until the session-owned history and replay surface is fully adopted.
- Keep sandbox-specific routes grouped under one sandbox resource tree.
- Expose only the Main Harness to external clients; other services are internal-only.

## Tracing

- Use W3C tracecontext end to end.
- Start one root span per inbound request in Main Harness.
- Propagate `traceparent`, `tracestate`, and request and session identifiers to every downstream call.
- Add child spans for session mutations, replay batches, sandbox execution, and MCP and tool calls.
- Correlate logs with `trace_id`, `session_id`, `workspace_id`, `tool_name`, and `request_id`.
- Sample all mutation and replay spans; sample read-only traffic conservatively.

## Session history and replay

- Store session mutations as append-only events keyed by session ID and sequence.
- Build read models for list, status, summary, and todo views from the event log.
- Add periodic snapshots so replay does not require scanning the full log for every restore.
- Support replay from any valid sequence boundary into a fresh sandbox or restored workspace.
- Keep replay deterministic, idempotent, and schema and version checked.
- Preserve the current sync replay semantics as the internal restore mechanism.

## Phased rollout

### Phase 0: Boundary definition

- Freeze the current public routes and map each route to one owning service.
- Define service contracts, request and response schemas, and trace propagation requirements.
- Identify which writes move first: session history, sandbox execution, and MCP and tool lifecycle.

### Phase 1: Session system of record

- Extract session persistence, status, summary, todo, and history reads and writes.
- Move append-only event storage and snapshots into Session Management.
- Keep `/sync/history` and `/sync/replay` wired to the new session event store.

### Phase 2: Sandbox extraction

- Move PTY, process execution, filesystem mutation, and workspace restore logic into Sandboxing.
- Route command execution and replay targets through the sandbox service.
- Remove direct sandbox state mutation from Main Harness.

### Phase 3: Tools and MCP extraction

- Move MCP registration, auth, connect and disconnect, and tool execution brokering into Tools and MCP Management.
- Keep model and provider orchestration in Main Harness.
- Add trace spans around every tool call and MCP round trip.

### Phase 4: Harness thinning

- Reduce Main Harness to routing, orchestration, and streaming composition.
- Remove direct ownership of session, sandbox, and tool state.
- Keep compatibility adapters only where external clients still depend on old shapes.

### Phase 5: Hardening

- Add service-level timeouts, retries, and circuit breakers.
- Add replay verification and trace assertions to integration tests.
- Remove dead in-process paths once each remote service is stable.

## Validation strategy

- Contract tests for every public route group.
- Integration tests for session create, update, history, and replay flows.
- End-to-end tests for sandbox execution and MCP and tool invocation.
- Trace propagation tests across all service hops.
- Replay consistency tests that compare reconstructed state to live state.

## Risk mitigation

- Keep the first rollout behind compatibility shims.
- Move one aggregate boundary at a time.
- Prefer write-path extraction before read-path optimization.
- Keep replay and event schema versioned from day one.
- Fail closed on trace and auth propagation gaps.

## Definition of done

- The four services own their boundaries independently.
- Public resource routes still work through the same surface area.
- Session history can be queried and replayed from the session store.
- Traces follow a single request across all service hops.
- Sandboxing, sessions, and tools can scale without deploying the whole harness together.
