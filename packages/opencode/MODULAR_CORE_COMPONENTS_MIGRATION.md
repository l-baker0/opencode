# Scalable Headless OpenCode Implementation Plan

Practical phased transition from local-only to distributed headless execution.

## Goal

Decouple the OpenCode execution environment from the local machine by abstracting core utilities into a `RemoteContext` and implementing a centralized session registry.

## Decisions

- Align with existing `packages/opencode/src/util` patterns.
- Use interface-driven design for `FileSystem` and `Process`.
- Implement Redis-based locking for session concurrency.
- Utilize S3/GCS for content-addressed snapshot storage.
- Implement SSO-based authentication as an alternative to HTTP Basic Auth.

## Non-goals

- Do not replace the existing `LocalContext` for CLI usage.
- Do not modify the core LLM orchestration logic.

## Constraints

- Maintain parity between `Local` and `Remote` execution behavior.
- Ensure atomic state updates during worker handoffs.
- Minimize latency in remote snapshot rehydration.

## Context API Proposal (`src/util/context.ts`)

Refactor utilities into injectable service layers.

Core Interfaces:
- `IFileSystem`: `read`, `write`, `delete`, `exists`, `list`.
- `IProcess`: `run`, `spawn`, `git`, `shell`.

Context Types:
- `LocalContext`: Direct access to host FS and Bun shell.
- `RemoteContext`: Proxy calls via gRPC/REST to a Sandbox Sidecar.

## Phased Rollout

### Phase 0: Foundation
- Define `IFileSystem` and `IProcess` interfaces in `src/util/`.
- Refactor `src/util/filesystem.ts` and `src/util/process.ts` as implementations.
- Update `ManagedRuntime` to support dynamic context injection.

### Phase 1: Session Registry & Locking
- Implement Postgres-backed session store for metadata and turn history.
- Add Redis-based distributed locking on `session_id`.
- Ensure single-worker affinity per active session.

### Phase 2: Sandbox Sidecar (Context Server)
- Build lightweight execution agent for containers/MicroVMs.
- Expose `IFileSystem` and `IProcess` methods via API.
- Implement `RemoteContext` provider to communicate with the sidecar.

### Phase 3: Remote Durability
- Modify snapshotter to package changes as blobs for S3/GCS.
- Implement atomic `SnapshotHash` updates in the Registry post-tool call.
- Add lazy rehydration logic to pull state into new sandboxes.

### Phase 4: Production Scaling
- Deploy headless workers as stateless fleet.
- Implement reaper for idle sandbox termination.
- Add `trace_id` propagation for brain-to-sandbox observability.
- Optimize snapshot storage with delta encoding and compression.
- Implement SSO-based authentication for secure API access.

## Validation Strategy
- Contract tests for `IFileSystem` and `IProcess` across implementations.
- Integration tests for Redis lock acquisition and release.
- End-to-end smoke tests for remote snapshot recovery.
- Load testing for high-concurrency session switching.
- Access control tests for authentication and authorization.

## Definition of Done
- `RemoteContext` successfully executes agent tasks in an isolated sandbox.
- Sessions can be resumed by different workers via `SnapshotHash`.
- Local execution remains unchanged and stable.
- CI passes for both local and remote provider configurations.
