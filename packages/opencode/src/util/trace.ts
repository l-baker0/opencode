import { context, trace, type SpanContext } from "@opentelemetry/api"

export type Metadata = {
    projectID?: string
    requestID?: string
    sessionID?: string
    workspaceID?: string
}

export function headers(init?: HeadersInit, metadata?: Metadata, spanContext?: SpanContext | null) {
    const out = new Headers(init)

    const active = spanContext ?? trace.getSpanContext(context.active())
    if (active) {
        const flags = (active.traceFlags & 1) === 1 ? "01" : "00"
        out.set("traceparent", `00-${active.traceId}-${active.spanId}-${flags}`)
        if (active.traceState) out.set("tracestate", active.traceState.serialize())
    }

    if (metadata?.projectID) out.set("x-opencode-project", metadata.projectID)
    if (metadata?.requestID) out.set("x-request-id", metadata.requestID)
    if (metadata?.sessionID) out.set("x-opencode-session", metadata.sessionID)
    if (metadata?.workspaceID) out.set("x-opencode-workspace", metadata.workspaceID)

    return out
}

export * as Trace from "./trace"
