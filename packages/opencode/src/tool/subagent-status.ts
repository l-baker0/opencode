import z from "zod"
import { Tool } from "./tool"
import { Subagent } from "../subagent"

const parameters = z.object({
  subagent_id: z
    .string()
    .optional()
    .describe("Optional: specific subagent ID to check. If omitted, lists all subagents in the current session."),
})

export const SubagentStatusTool = Tool.define("subagent_status", async () => {
  return {
    description: [
      "Check the status of background subagents in the current session.",
      "If no subagent_id is provided, returns the status of all subagents in the session.",
      "If a subagent_id is provided, returns detailed status for that specific subagent.",
      "",
      "Status values:",
      "- spawning: subagent is being initialized",
      "- active: subagent is currently running",
      "- completed: subagent finished successfully — use subagent_ingest to retrieve results",
      "- error: subagent encountered an error",
    ].join("\n"),
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.subagent_id) {
        const info = Subagent.get(params.subagent_id)
        return {
          title: `Status: ${info.agentName} (${info.status})`,
          metadata: {
            subagentID: info.id,
            status: info.status,
          },
          output: formatSubagentInfo(info),
        }
      }

      const all = Subagent.listForSession(ctx.sessionID)
      if (all.length === 0) {
        return {
          title: "No subagents",
          metadata: {},
          output: "No background subagents have been spawned in this session.",
        }
      }

      const lines = all.map((info) => formatSubagentSummary(info))
      return {
        title: `${all.length} subagent(s)`,
        metadata: {
          count: all.length,
          statuses: Object.fromEntries(all.map((s) => [s.id, s.status])),
        },
        output: [
          `Background subagents in this session:`,
          ``,
          ...lines,
          ``,
          `Use \`subagent_ingest\` to retrieve results from completed subagents.`,
        ].join("\n"),
      }
    },
  }
})

function formatSubagentInfo(info: Subagent.Info): string {
  const lines = [
    `Subagent ID: ${info.id}`,
    `Agent: ${info.agentName}`,
    `Status: ${info.status}`,
    `Last Heartbeat: ${new Date(info.lastHeartbeat).toISOString()}`,
  ]
  if (info.error) {
    lines.push(`Error: ${info.error}`)
  }
  if (info.abortRequested) {
    lines.push(`Abort Requested: yes`)
  }
  return lines.join("\n")
}

function formatSubagentSummary(info: Subagent.Info): string {
  const status = info.error ? `${info.status} (${info.error})` : info.status
  return `- ${info.id} | ${info.agentName} | ${status}`
}
