import z from "zod"
import { Tool } from "./tool"
import { Subagent } from "../subagent"

const parameters = z.object({
  task_id: z
    .string()
    .optional()
    .describe(
      "Optional: specific task ID to ingest. If omitted, ingests all completed tasks in the current session.",
    ),
})

export const SubagentIngestTool = Tool.define("subagent_ingest", async () => {
  return {
    description: [
      "Retrieve and ingest results from completed background subagents.",
      "Pulls the output from the task bus and marks the task as ingested so it won't appear in future reminders.",
      "",
      "If a task_id is provided, ingests that specific task.",
      "If no task_id is provided, ingests all completed tasks in the current session.",
      "",
      "You should call this tool when:",
      "- A system reminder notifies you that background tasks have completed",
      "- You want to check if any background tasks have finished and retrieve their results",
    ].join("\n"),
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.task_id) {
        const task = Subagent.getTask(params.task_id)
        if (task.state !== "completed") {
          return {
            title: `Task ${params.task_id}: ${task.state}`,
            metadata: { taskID: task.id, state: task.state },
            output: `Task ${params.task_id} is not yet completed (current state: ${task.state}). Use \`subagent_status\` to check progress.`,
          }
        }

        const result = task.result ?? {}
        const output = formatTaskResult(task, result)
        Subagent.markIngested(task.id)

        return {
          title: `Ingested task ${task.id}`,
          metadata: {
            taskID: task.id,
            hasError: !!result.error,
          },
          output,
        }
      }

      // Ingest all completed tasks
      const completed = Subagent.completedTasksForSession(ctx.sessionID)
      if (completed.length === 0) {
        return {
          title: "No completed tasks",
          metadata: {},
          output:
            "No completed background tasks to ingest. Use `subagent_status` to check if any are still running.",
        }
      }

      const results: string[] = []
      for (const task of completed) {
        const result = task.result ?? {}
        const output = formatTaskResult(task, result)
        Subagent.markIngested(task.id)
        results.push(output)
      }

      return {
        title: `Ingested ${completed.length} task(s)`,
        metadata: {
          count: completed.length,
          taskIDs: completed.map((t) => t.id),
        },
        output: results.join("\n\n---\n\n"),
      }
    },
  }
})

function formatTaskResult(task: Subagent.TaskInfo, result: Record<string, unknown>): string {
  const agent = (task.payload.agent as string) ?? "unknown"
  const description = (task.payload.description as string) ?? ""

  const header = result.error
    ? `## Task ${task.id} — ${agent} (ERROR)`
    : `## Task ${task.id} — ${agent}`

  const lines = [header]

  if (description) {
    lines.push(`Description: ${description}`)
  }

  lines.push("")

  if (result.error) {
    lines.push(`Error: ${result.error}`)
  } else if (result.output) {
    lines.push(String(result.output))
  } else {
    lines.push("No output returned.")
  }

  if (result.metadata && typeof result.metadata === "object") {
    const meta = result.metadata as Record<string, unknown>
    if (meta.childSessionID) {
      lines.push("")
      lines.push(`Child session: ${meta.childSessionID}`)
    }
  }

  return lines.join("\n")
}
