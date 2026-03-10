import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { Database, eq, and } from "../storage/db"
import { SubagentTable, TaskBusTable } from "./subagent.sql"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"

export namespace Subagent {
  const log = Log.create({ service: "subagent" })

  // ── Bus Events ──────────────────────────────────────────────────────

  export const Event = {
    Spawned: BusEvent.define(
      "subagent.spawned",
      z.object({
        id: z.string(),
        sessionID: z.string(),
        agentName: z.string(),
      }),
    ),
    StatusChanged: BusEvent.define(
      "subagent.status_changed",
      z.object({
        id: z.string(),
        sessionID: z.string(),
        status: z.string(),
        error: z.string().optional(),
      }),
    ),
    TaskCompleted: BusEvent.define(
      "subagent.task_completed",
      z.object({
        taskID: z.string(),
        subagentID: z.string(),
        sessionID: z.string(),
      }),
    ),
  }

  // ── Types ───────────────────────────────────────────────────────────

  export const Status = z.enum(["spawning", "active", "completed", "error"])
  export type Status = z.infer<typeof Status>

  export const TaskState = z.enum(["pending", "processing", "completed", "ingested"])
  export type TaskState = z.infer<typeof TaskState>

  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    agentName: z.string(),
    status: Status,
    lastHeartbeat: z.number(),
    messageID: z.string().optional(),
    abortRequested: z.boolean(),
    error: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export const TaskInfo = z.object({
    id: z.string(),
    sessionID: z.string(),
    senderID: z.string().optional(),
    recipientID: z.string().optional(),
    payload: z.record(z.unknown()),
    result: z.record(z.unknown()).optional(),
    state: TaskState,
    priority: z.number(),
  })
  export type TaskInfo = z.infer<typeof TaskInfo>

  // ── Row Mapping ─────────────────────────────────────────────────────

  function fromSubagentRow(row: typeof SubagentTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      agentName: row.agent_name,
      status: row.status as Status,
      lastHeartbeat: row.last_heartbeat,
      messageID: row.message_id ?? undefined,
      abortRequested: row.abort_requested,
      error: row.error ?? undefined,
    }
  }

  function fromTaskRow(row: typeof TaskBusTable.$inferSelect): TaskInfo {
    return {
      id: row.id,
      sessionID: row.session_id,
      senderID: row.sender_id ?? undefined,
      recipientID: row.recipient_id ?? undefined,
      payload: row.payload as Record<string, unknown>,
      result: (row.result as Record<string, unknown>) ?? undefined,
      state: row.state as TaskState,
      priority: row.priority,
    }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────

  const HEARTBEAT_INTERVAL_MS = 30_000
  const ZOMBIE_THRESHOLD_MS = 300_000

  const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()

  function startHeartbeat(subagentID: string) {
    stopHeartbeat(subagentID)
    const timer = setInterval(() => {
      try {
        Database.use((db) => {
          db.update(SubagentTable)
            .set({ last_heartbeat: Date.now(), time_updated: Date.now() })
            .where(eq(SubagentTable.id, subagentID))
            .run()
        })
      } catch (e) {
        log.error("heartbeat failed", { subagentID, error: e instanceof Error ? e : undefined })
      }
    }, HEARTBEAT_INTERVAL_MS)
    heartbeatTimers.set(subagentID, timer)
  }

  function stopHeartbeat(subagentID: string) {
    const timer = heartbeatTimers.get(subagentID)
    if (timer) {
      clearInterval(timer)
      heartbeatTimers.delete(subagentID)
    }
  }

  // ── Zombie Reaping ──────────────────────────────────────────────────

  let reaperTimer: ReturnType<typeof setInterval> | undefined

  export function startReaper() {
    if (reaperTimer) return
    reaperTimer = setInterval(() => {
      reapZombies()
    }, 5 * 60_000)
  }

  export function stopReaper() {
    if (reaperTimer) {
      clearInterval(reaperTimer)
      reaperTimer = undefined
    }
  }

  function reapZombies() {
    const cutoff = Date.now() - ZOMBIE_THRESHOLD_MS
    try {
      const zombies = Database.use((db) =>
        db
          .select()
          .from(SubagentTable)
          .where(eq(SubagentTable.status, "active"))
          .all()
          .filter((row) => row.last_heartbeat < cutoff),
      )

      for (const zombie of zombies) {
        log.warn("reaping zombie subagent", {
          id: zombie.id,
          lastHeartbeat: zombie.last_heartbeat,
        })
        const now = Date.now()
        Database.use((db) => {
          db.update(SubagentTable)
            .set({
              abort_requested: true,
              status: "error",
              error: "Zombie reaped: heartbeat timeout",
              time_updated: now,
            })
            .where(eq(SubagentTable.id, zombie.id))
            .run()
        })
        stopHeartbeat(zombie.id)
        Bus.publish(Event.StatusChanged, {
          id: zombie.id,
          sessionID: zombie.session_id,
          status: "error",
          error: "Zombie reaped: heartbeat timeout",
        })
      }
    } catch (e) {
      log.error("zombie reaper failed", { error: e instanceof Error ? e : undefined })
    }
  }

  // ── Spawn ───────────────────────────────────────────────────────────

  export interface SpawnInput {
    sessionID: string
    agentName: string
    prompt: string
    description?: string
    providerID?: string
    modelID?: string
    senderID?: string
  }

  export async function spawn(input: SpawnInput): Promise<Info> {
    const subagentID = Identifier.ascending("subagent")
    const now = Date.now()

    Database.use((db) => {
      db.insert(SubagentTable)
        .values({
          id: subagentID,
          session_id: input.sessionID,
          agent_name: input.agentName,
          status: "spawning",
          last_heartbeat: now,
          abort_requested: false,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    Bus.publish(Event.Spawned, {
      id: subagentID,
      sessionID: input.sessionID,
      agentName: input.agentName,
    })

    const taskID = Identifier.ascending("task")
    Database.use((db) => {
      db.insert(TaskBusTable)
        .values({
          id: taskID,
          session_id: input.sessionID,
          sender_id: input.senderID ?? null,
          recipient_id: subagentID,
          payload: {
            prompt: input.prompt,
            description: input.description,
            agent: input.agentName,
          },
          state: "pending",
          priority: 0,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    runSubagent({
      subagentID,
      taskID,
      sessionID: input.sessionID,
      agentName: input.agentName,
      prompt: input.prompt,
      description: input.description,
      providerID: input.providerID,
      modelID: input.modelID,
    }).catch((e) => {
      log.error("subagent background task failed unexpectedly", {
        subagentID,
        error: e instanceof Error ? e : undefined,
      })
    })

    return get(subagentID)
  }

  // ── Background Runner ───────────────────────────────────────────────

  async function runSubagent(input: {
    subagentID: string
    taskID: string
    sessionID: string
    agentName: string
    prompt: string
    description?: string
    providerID?: string
    modelID?: string
  }) {
    const { subagentID, taskID, sessionID, agentName, prompt, description } = input

    try {
      // Transition: spawning -> active
      Database.use((db) => {
        db.update(SubagentTable)
          .set({ status: "active", last_heartbeat: Date.now(), time_updated: Date.now() })
          .where(eq(SubagentTable.id, subagentID))
          .run()
        db.update(TaskBusTable)
          .set({ state: "processing", time_updated: Date.now() })
          .where(eq(TaskBusTable.id, taskID))
          .run()
      })

      Bus.publish(Event.StatusChanged, {
        id: subagentID,
        sessionID,
        status: "active",
      })

      startHeartbeat(subagentID)

      // Resolve provider/model
      let providerID = input.providerID
      let modelID = input.modelID
      if (!providerID || !modelID) {
        const defaultModel = await Provider.defaultModel()
        providerID = providerID ?? defaultModel.providerID
        modelID = modelID ?? defaultModel.modelID
      }

      // Create a child session for the subagent
      const parentSession = Session.get(sessionID)
      const childSession = await Session.create({
        modelID,
        providerID,
        agentID: agentName,
        path: parentSession.directory,
      })

      log.info("subagent child session created", {
        subagentID,
        childSessionID: childSession.id,
        agent: agentName,
      })

      // Run the LLM loop via SessionPrompt.prompt
      await SessionPrompt.prompt({
        sessionID: childSession.id,
        providerID,
        modelID,
        agentID: agentName,
        parts: [
          {
            type: "text",
            text: description
              ? `${description}\n\n${prompt}`
              : prompt,
          },
        ],
      })

      // Extract output from the child session's messages
      const output = await extractSessionOutput(childSession.id)

      // Transition: active -> completed
      stopHeartbeat(subagentID)
      const now = Date.now()
      Database.use((db) => {
        db.update(SubagentTable)
          .set({ status: "completed", last_heartbeat: now, time_updated: now })
          .where(eq(SubagentTable.id, subagentID))
          .run()
        db.update(TaskBusTable)
          .set({
            state: "completed",
            result: {
              output,
              metadata: {
                childSessionID: childSession.id,
                agentName,
              },
            },
            time_updated: now,
          })
          .where(eq(TaskBusTable.id, taskID))
          .run()
      })

      Bus.publish(Event.StatusChanged, {
        id: subagentID,
        sessionID,
        status: "completed",
      })
      Bus.publish(Event.TaskCompleted, {
        taskID,
        subagentID,
        sessionID,
      })

      log.info("subagent completed", { subagentID, taskID })
    } catch (e) {
      stopHeartbeat(subagentID)
      const errorMsg = e instanceof Error ? e.message : String(e)
      log.error("subagent execution error", {
        subagentID,
        error: e instanceof Error ? e : undefined,
      })

      const now = Date.now()
      Database.use((db) => {
        db.update(SubagentTable)
          .set({
            status: "error",
            error: errorMsg,
            last_heartbeat: now,
            time_updated: now,
          })
          .where(eq(SubagentTable.id, subagentID))
          .run()
        db.update(TaskBusTable)
          .set({
            state: "completed",
            result: { error: errorMsg },
            time_updated: now,
          })
          .where(eq(TaskBusTable.id, taskID))
          .run()
      })

      Bus.publish(Event.StatusChanged, {
        id: subagentID,
        sessionID,
        status: "error",
        error: errorMsg,
      })
      Bus.publish(Event.TaskCompleted, {
        taskID,
        subagentID,
        sessionID,
      })
    }
  }

  async function extractSessionOutput(childSessionID: string): Promise<string> {
    const messages = Session.Message.list({ sessionID: childSessionID })
    const outputParts: string[] = []

    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      const parts = Session.MessageParts.list({ messageID: msg.id })
      for (const part of parts) {
        if (part.type === "text" && part.text) {
          outputParts.push(part.text)
        }
      }
    }

    return outputParts.join("\n\n") || "Subagent completed with no text output."
  }

  // ── Query ───────────────────────────────────────────────────────────

  export function get(subagentID: string): Info {
    const row = Database.use((db) =>
      db.select().from(SubagentTable).where(eq(SubagentTable.id, subagentID)).get(),
    )
    if (!row) throw new Error(`Subagent not found: ${subagentID}`)
    return fromSubagentRow(row)
  }

  export function listForSession(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(SubagentTable)
        .where(eq(SubagentTable.session_id, sessionID))
        .all(),
    )
    return rows.map(fromSubagentRow)
  }

  export function getTask(taskID: string): TaskInfo {
    const row = Database.use((db) =>
      db.select().from(TaskBusTable).where(eq(TaskBusTable.id, taskID)).get(),
    )
    if (!row) throw new Error(`Task not found: ${taskID}`)
    return fromTaskRow(row)
  }

  export function completedTasksForSession(sessionID: string): TaskInfo[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(TaskBusTable)
        .where(
          and(
            eq(TaskBusTable.session_id, sessionID),
            eq(TaskBusTable.state, "completed"),
          ),
        )
        .all(),
    )
    return rows.map(fromTaskRow)
  }

  export function markIngested(taskID: string) {
    Database.use((db) => {
      db.update(TaskBusTable)
        .set({ state: "ingested", time_updated: Date.now() })
        .where(eq(TaskBusTable.id, taskID))
        .run()
    })
  }
}
