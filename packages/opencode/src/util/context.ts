import { Context, Layer } from "effect"
import * as Filesystem from "./filesystem"
import * as Process from "./process"

export type IFileSystem = {
    readonly read: (path: string) => Promise<string>
    readonly write: (path: string, content: string | Buffer | Uint8Array, mode?: number) => Promise<void>
    readonly delete: (path: string) => Promise<void>
    readonly exists: (path: string) => Promise<boolean>
    readonly list: (path: string) => Promise<string[]>
}

export type IProcess = {
    readonly run: typeof Process.run
    readonly spawn: typeof Process.spawn
    readonly git: typeof Process.git
    readonly shell: typeof Process.shell
}

export interface Interface {
    readonly filesystem: IFileSystem
    readonly process: IProcess
}

export interface LocalContext extends Interface {
    readonly kind: "local"
}

export interface RemoteContext extends Interface {
    readonly kind: "remote"
    readonly endpoint: string
}

export type AnyContext = LocalContext | RemoteContext

export class Service extends Context.Service<Service, AnyContext>()("@opencode/Context") { }

export const defaultContext = {
    kind: "local",
    filesystem: {
        read: Filesystem.readText,
        write: Filesystem.write,
        delete: Filesystem.remove,
        exists: Filesystem.exists,
        list: Filesystem.list,
    },
    process: {
        run: Process.run,
        spawn: Process.spawn,
        git: Process.git,
        shell: Process.shell,
    },
} satisfies LocalContext

export const layer = Layer.succeed(Service, defaultContext)

export const defaultLayer = layer
