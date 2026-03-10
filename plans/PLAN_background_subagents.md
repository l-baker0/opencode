# Implementation Plan: Backgrounded Subagent Orchestration

## 1. Data Layer: Task Bus (Existing Bun SQLite)
Add subagent coordination tables to the existing OpenCode database, leveraging the established `Database.use()` / `Database.effect()` pattern.

* **Schema Setup (via migration):**
    * **Table `subagents`:** `id` (UUID), `agent_name`, `status` (spawning/active/completed/error), `last_heartbeat`, `session_id`, `message_id`, `abort_requested`.
    * **Table `task_bus`:** `id`, `sender_id`, `recipient_id`, `payload` (JSON), `result` (JSON), `state` (pending/processing/completed/ingested), `priority`.
* **Indexing:** 
    * Partial index on `state = 'pending'` AND `recipient_id` for $O(1)$ subagent task lookups
    * Index on `session_id` for cleanup operations
    * Index on `last_heartbeat` for zombie detection

## 2. In-Process Task Management & Health Monitoring
Implement async subagents as spawned tasks within the existing Node.js process, using the established `TaskTool` pattern.

* **Subagent Spawning:** Extend `TaskTool` to support background mode:
    1. Insert into `subagents` table with `status='spawning'`
    2. Spawn async task using existing `SessionPrompt.loop()` infrastructure
    3. Update `status='active'` and begin heartbeat updates every 30s
* **Zombie Reaping:** A periodic cleanup (every 5 minutes) identifies rows where `last_heartbeat` is older than 300s (5 minutes), sets `abort_requested=true`, and publishes abort events via the existing `Bus` system.

## 3. Task Bus & Inter-Agent Communication
Decouple main agent from subagent execution using a database-backed message queue.

* **Producer:** Main agent writes to `task_bus` with a `recipient_id` targeting specific subagents.
* **Consumer:** Subagents poll `task_bus` every 10s for `state='pending'` messages addressed to them.
* **Peer-to-Peer:** Subagents can publish messages to other subagents via `task_bus`, enabling collaborative workflows.
* **Bus Integration:** Status changes publish to `Bus.Event` for reactive UI updates (no polling required).

## 4. Loop Integration & Turn Boundary Injection
Inject status updates at End of Turn (EOT) in `SessionPrompt.loop()` using existing reminder patterns.

* **EOT Injection Point:** In the main `while(true)` loop after LLM processing, before `continue`/`break`
* **Status Sweep:** Query `task_bus` for completed tasks in current session:
    ```typescript
    const completed = db.select().from(TaskBusTable)
      .where(and(eq(TaskBusTable.session_id, sessionID), eq(TaskBusTable.state, 'completed')))
    ```
* **Reminder Format:** Use existing `<system-reminder>` tag (hyphen, not underscore):
    ```xml
    <system-reminder>
    The following background tasks have completed:
    - Task ID: [ID] | Subagent: [Name] | Status: Success
    - Task ID: [ID] | Subagent: [Name] | Status: Error (Check Logs)
    Use `subagent_ingest` to review these outputs.
    </system-reminder>
    ```

## 5. Progressive Disclosure & Result Management
Manage context window pressure using existing truncation infrastructure.

* **Tool `subagent_ingest`:** 
    * Pulls `result` JSON from `task_bus` table
    * Uses `Truncate.output()` for length > 2000 chars, provides "Summary + Head" view
    * Marks task as `state='ingested'` to clear from future `<system-reminder>` injections
* **Permission Integration:** All subagent operations go through `PermissionNext.ask()` with agent-specific rulesets

## 6. Execution Roadmap
1. **Sprint 1:** Migration file + `subagents`/`task_bus` tables + basic `subagent_spawn` tool
2. **Sprint 2:** Heartbeat system + zombie reaping + `Bus` event integration
3. **Sprint 3:** EOT injection in `SessionPrompt.loop()` + `subagent_ingest` tool
4. **Sprint 4:** Inter-agent messaging + sidebar status integration via Bus events
