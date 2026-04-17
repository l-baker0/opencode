import { describe, expect, test } from "bun:test"
import { WorkspaceID } from "../../src/control-plane/schema"
import { ServerProxy } from "../../src/server/proxy"
import { spanContext } from "../fixture/trace"

describe("server.proxy", () => {
    test("requestHeaders() strips hop-by-hop headers and injects tracing metadata", () => {
        const req = new Request("https://example.test/api", {
            headers: {
                connection: "keep-alive",
                "accept-encoding": "gzip",
                "x-opencode-directory": "/tmp/dir",
                "x-opencode-workspace": "old-workspace",
                "x-original": "value",
            },
        })

        const headers = ServerProxy.requestHeaders(
            req,
            {
                "x-extra": "1",
                traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00",
            },
            WorkspaceID.make("workspace-1"),
            spanContext(),
        )

        expect(headers.get("connection")).toBeNull()
        expect(headers.get("accept-encoding")).toBeNull()
        expect(headers.get("x-opencode-directory")).toBeNull()
        expect(headers.get("x-opencode-workspace")).toBe("workspace-1")
        expect(headers.get("x-original")).toBe("value")
        expect(headers.get("x-extra")).toBe("1")
        expect(headers.get("traceparent")).toBe("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01")
    })
})
