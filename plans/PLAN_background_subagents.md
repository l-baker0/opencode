# Implementation Plan: Backgrounded Subagent Orchestration

## 1. Data Layer: Virtual Inbox/Outbox (Bun SQLite)
Establish `orchestrator.db` to serve as the "Single Source of Truth" for subagent coordination, replacing physical directories with high-performance tables.

* **Schema Setup:** * **Table `subagents`:** `id` (PTY Handle), `status` (active/idle/zombie), `last_pulse`, `pid`.
    * **Table `task_bus`:** `id`, `sender`, `recipient`, `payload`, `result`, `state` (pending/processing/completed/ingested).
* **Indexing:** Partial index on `state` where `state = 'pending'` to ensure subagent lookups remain $O(1)$.

## 2. Process Management & Health Reporting
Utilize `pty_` tools to manage lifecycle and maintain a "Pulse" for monitoring.

* **The Shim Wrapper:** Every `pty_spawn` executes a wrapper that:
    1. Registers its PID in `subagents`.
    2. Enters a loop: `Check Task Bus` -> `Update Pulse` -> `Execute` -> `Post Result`.
* **Zombie Reaping:** A periodic `reap_zombies()` utility identifies rows where `last_pulse` is older than 30s, calls `pty_kill` on the handle, and marks the task as `failed` for cleanup.

## 3. Dual-Buffered Queue & Inter-Agent Comms
Decouple the main agent from subagent execution using a producer/consumer model.

* **Producer:** Main agent writes to `task_bus` with a `recipient` ID.
* **Consumer:** Subagents query for their specific ID. 
* **Peer-to-Peer:** Subagents can publish messages to the `task_bus` addressed to other subagents, allowing for collaborative workflows without main-agent overhead.

## 4. Loop Integration & XML Reminders
Inject status updates at the End of Turn (EOT) using the standard OpenCode XML convention.

* **Observation Masking:** All raw PTY output is redirected to the `result` column in SQLite. The main loop remains clean.
* **EOT Injection Logic:**
    * At the end of every turn, the system performs a "Sweep" of the `task_bus`.
    * If results are ready, it appends the following to the prompt:
    ```xml
    <system_reminder>
    The following background tasks have completed:
    - Task ID: [ID] | Subagent: [Name] | Status: Success
    - Task ID: [ID] | Subagent: [Name] | Status: Error (Check Logs)
    Use `pty_ingest_results` to review these outputs.
    </system_reminder>
    ```
* **Sidebar Sync:** A background hook polls `subagents` to populate the UI sidebar with real-time status and "Pulse" indicators.

## 5. Progressive Disclosure
Manage context window pressure by lazy-loading results.

* **Tool `pty_ingest_results`:** * Pulls the `result` blob from SQLite.
    * If length > 2000 chars, it provides a "Summary + Head" view.
    * Marks the task as `ingested` in the DB to clear the `<system_reminder>`.

## 6. Execution Roadmap
1. **Sprint 1:** SQL Schema + `pty_spawn` Shim (Health/Pulse logic).
2. **Sprint 2:** Reaper Utility + Inter-agent messaging via `task_bus`.
3. **Sprint 3:** EOT XML Injection Hook + Sidebar status integration.
4. **Sprint 4:** Progressive Disclosure tool + Observation Masking filters.
