-- Add subagent coordination tables
CREATE TABLE IF NOT EXISTS "subagents" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"status" text NOT NULL,
	"last_heartbeat" integer NOT NULL,
	"session_id" text NOT NULL,
	"message_id" text NOT NULL,
	"abort_requested" integer DEFAULT false NOT NULL,
	"time_created" integer NOT NULL,
	"time_updated" integer NOT NULL,
	FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE cascade,
	FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "subagent_session_idx" ON "subagents" ("session_id");
CREATE INDEX IF NOT EXISTS "subagent_heartbeat_idx" ON "subagents" ("last_heartbeat");

CREATE TABLE IF NOT EXISTS "task_bus" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"payload" text NOT NULL,
	"result" text,
	"state" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"session_id" text NOT NULL,
	"message_id" text NOT NULL,
	"time_created" integer NOT NULL,
	"time_updated" integer NOT NULL,
	FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE cascade,
	FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "task_bus_pending_idx" ON "task_bus" ("state","recipient_id") WHERE "state" = 'pending';
CREATE INDEX IF NOT EXISTS "task_bus_session_idx" ON "task_bus" ("session_id");
CREATE INDEX IF NOT EXISTS "task_bus_message_idx" ON "task_bus" ("message_id");
