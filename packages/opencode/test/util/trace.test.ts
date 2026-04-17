import { describe, expect, test } from "bun:test"
import { Trace } from "../../src/util"
import { spanContext } from "../fixture/trace"

describe("trace", () => {
    test("headers() injects trace context and opencode metadata", () => {
        const headers = Trace.headers(
            new Headers({ "x-original": "value", traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00" }),
            {
                projectID: "project-1",
                requestID: "request-1",
                sessionID: "session-1",
                workspaceID: "workspace-1",
            },
            spanContext(),
        )

        expect(headers.get("x-original")).toBe("value")
        expect(headers.get("traceparent")).toBe("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01")
        expect(headers.get("x-opencode-project")).toBe("project-1")
        expect(headers.get("x-request-id")).toBe("request-1")
        expect(headers.get("x-opencode-session")).toBe("session-1")
        expect(headers.get("x-opencode-workspace")).toBe("workspace-1")
    })

    test("headers() keeps existing trace headers when no span context is active", () => {
        const headers = Trace.headers(
            new Headers({
                "x-original": "value",
                traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00",
                tracestate: "vendor=value",
            }),
            {
                sessionID: "session-1",
            },
        )

        expect(headers.get("traceparent")).toBe("00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00")
        expect(headers.get("tracestate")).toBe("vendor=value")
        expect(headers.get("x-opencode-session")).toBe("session-1")
    })
})
