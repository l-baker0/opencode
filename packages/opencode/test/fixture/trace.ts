import type { SpanContext } from "@opentelemetry/api"

export function spanContext(overrides?: Partial<SpanContext>): SpanContext {
    return {
        traceId: "0123456789abcdef0123456789abcdef",
        spanId: "0123456789abcdef",
        traceFlags: 1,
        ...overrides,
    }
}
