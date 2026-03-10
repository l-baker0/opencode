import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

/**
 * Tracks spawned background subagents within the current process.
 *
 * Status lifecycle: spawning -> active -> completed | error
 * Zombie detection: rows where last_heartbeat is older than 300s
 */
export const SubagentTable = sqliteTable(
  "subagent",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent_name: text().notNull(),
    /** spawning | active | completed | error */
    status: text().notNull().default("spawning"),
    last_heartbeat: integer().notNull(),
    message_id: text(),
    /** When true, the subagent should abort at the next opportunity */
    abort_requested: integer({ mode: "boolean" }).notNull().default(false),
    /** Optional error message when status is 'error' */
    error: text(),
    ...Timestamps,
  },
  (table) => [
    index("subagent_session_idx").on(table.session_id),
    index("subagent_heartbeat_idx").on(table.last_heartbeat),
    index("subagent_status_idx").on(table.status),
  ],
)

/**
 * Database-backed message queue for inter-agent communication.
 *
 * State lifecycle: pending -> processing -> completed -> ingested
 *
 * Producer: main agent or peer subagent writes with recipient_id
 * Consumer: subagent polls for state='pending' messages addressed to it
 * EOT injection: main loop queries for state='completed' tasks to inject reminders
 */
export const TaskBusTable = sqliteTable(
  "task_bus",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    sender_id: text(),
    recipient_id: text(),
    /** JSON-encoded task payload */
    payload: text({ mode: "json" }).notNull().$type<{
      prompt: string
      description?: string
      agent?: string
      [key: string]: unknown
    }>(),
    /** JSON-encoded task result (set on completion) */
    result: text({ mode: "json" }).$type<{
      output?: string
      error?: string
      metadata?: Record<string, unknown>
      [key: string]: unknown
    }>(),
    /** pending | processing | completed | ingested */
    state: text().notNull().default("pending"),
    priority: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("task_bus_session_idx").on(table.session_id),
    index("task_bus_recipient_state_idx").on(table.recipient_id, table.state),
    index("task_bus_session_state_idx").on(table.session_id, table.state),
  ],
)
