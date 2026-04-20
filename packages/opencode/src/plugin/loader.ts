import {
  checkPluginCompatibility,
  createPluginEntry,
  isDeprecatedPlugin,
  pluginSource,
  resolvePluginTarget,
  type PluginKind,
  type PluginPackage,
  type PluginSource,
} from "./shared"
import { ConfigPlugin } from "@/config/plugin"
import { InstallationVersion } from "@/installation/version"
import { Filesystem } from "@/util"
import path from "path"
import { fileURLToPath } from "url"

export namespace PluginLoader {
  export type Plan = {
    spec: string
    options: ConfigPlugin.Options | undefined
    deprecated: boolean
  }
  export type Resolved = Plan & {
    source: PluginSource
    target: string
    entry: string
    pkg?: PluginPackage
  }
  export type Missing = Plan & {
    source: PluginSource
    target: string
    pkg?: PluginPackage
    message: string
  }
  export type Loaded = Resolved & {
    mod: Record<string, unknown>
  }

  type Candidate = { origin: ConfigPlugin.Origin; plan: Plan }
  type Attempt<R> = { value: R | undefined; retry: boolean }
  type Report = {
    start?: (candidate: Candidate, retry: boolean) => void
    missing?: (candidate: Candidate, retry: boolean, message: string, resolved: Missing) => void
    error?: (
      candidate: Candidate,
      retry: boolean,
      stage: "install" | "entry" | "compatibility" | "load",
      error: unknown,
      resolved?: Resolved,
    ) => void
  }

  function plan(item: ConfigPlugin.Spec): Plan {
    const spec = ConfigPlugin.pluginSpecifier(item)
    return { spec, options: ConfigPlugin.pluginOptions(item), deprecated: isDeprecatedPlugin(spec) }
  }

  export async function resolve(
    plan: Plan,
    kind: PluginKind,
  ): Promise<
    | { ok: true; value: Resolved }
    | { ok: false; stage: "missing"; value: Missing }
    | { ok: false; stage: "install" | "entry" | "compatibility"; error: unknown }
  > {
    let target = ""
    try {
      target = await resolvePluginTarget(plan.spec)
    } catch (error) {
      return { ok: false, stage: "install", error }
    }
    if (!target) return { ok: false, stage: "install", error: new Error(`Plugin ${plan.spec} target is empty`) }

    let base
    try {
      base = await createPluginEntry(plan.spec, target, kind)
    } catch (error) {
      return { ok: false, stage: "entry", error }
    }
    if (!base.entry)
      return {
        ok: false,
        stage: "missing",
        value: {
          ...plan,
          source: base.source,
          target: base.target,
          pkg: base.pkg,
          message: `Plugin ${plan.spec} does not expose a ${kind} entrypoint`,
        },
      }

    if (base.source === "npm") {
      try {
        await checkPluginCompatibility(base.target, InstallationVersion, base.pkg)
      } catch (error) {
        return { ok: false, stage: "compatibility", error }
      }
    }
    return { ok: true, value: { ...plan, source: base.source, target: base.target, entry: base.entry, pkg: base.pkg } }
  }

  export async function load(row: Resolved): Promise<{ ok: true; value: Loaded } | { ok: false; error: unknown }> {
    let mod
    try {
      mod = await import(row.entry)
    } catch (error) {
      return { ok: false, error }
    }
    if (!mod) return { ok: false, error: new Error(`Plugin ${row.spec} module is empty`) }
    return { ok: true, value: { ...row, mod } }
  }

  function pathForSpec(spec: string) {
    return spec.startsWith("file://") ? fileURLToPath(spec) : path.resolve(spec)
  }

  async function isDirectory(spec: string) {
    const stat = await Filesystem.statAsync(pathForSpec(spec))
    return stat?.isDirectory() ?? false
  }

  async function shouldRetryLoad(load: Resolved, error: unknown) {
    if (!(error instanceof Error)) return false
    if (!/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)|Failed to resolve module/i.test(error.message)) {
      return false
    }
    if (pluginSource(load.spec) !== "file") return false
    if (!load.entry.startsWith("file://")) return false
    return await Filesystem.exists(fileURLToPath(load.entry))
  }

  async function shouldRetryInstall(spec: string, error: unknown) {
    if (pluginSource(spec) !== "file") return false
    if (!(error instanceof Error)) return false
    if (!/missing package\.json or index file/i.test(error.message)) return false
    return await isDirectory(spec)
  }

  async function shouldRetryMissing(resolved: Missing) {
    if (resolved.source !== "file") return false
    return await isDirectory(resolved.target)
  }

  function shouldRetryFinish(load: Loaded) {
    return pluginSource(load.spec) === "file"
  }

  async function attempt<R>(
    candidate: Candidate,
    kind: PluginKind,
    retry: boolean,
    finish: ((load: Loaded, origin: ConfigPlugin.Origin, retry: boolean) => Promise<R | undefined>) | undefined,
    missing: ((value: Missing, origin: ConfigPlugin.Origin, retry: boolean) => Promise<R | undefined>) | undefined,
    report: Report | undefined,
  ): Promise<Attempt<R>> {
    const plan = candidate.plan
    if (plan.deprecated) return { value: undefined, retry: false }
    report?.start?.(candidate, retry)
    const resolved = await resolve(plan, kind)
    if (!resolved.ok) {
      if (resolved.stage === "missing") {
        if (missing) {
          const value = await missing(resolved.value, candidate.origin, retry)
          if (value !== undefined) return { value, retry: false }
        }
        const retryable = !retry && (await shouldRetryMissing(resolved.value))
        if (!retryable) report?.missing?.(candidate, retry, resolved.value.message, resolved.value)
        return { value: undefined, retry: retryable }
      }
      const retryable = !retry && resolved.stage === "install" && (await shouldRetryInstall(plan.spec, resolved.error))
      if (!retryable) report?.error?.(candidate, retry, resolved.stage, resolved.error)
      return { value: undefined, retry: retryable }
    }
    const loaded = await load(resolved.value)
    if (!loaded.ok) {
      const retryable = !retry && (await shouldRetryLoad(resolved.value, loaded.error))
      if (!retryable) report?.error?.(candidate, retry, "load", loaded.error, resolved.value)
      return { value: undefined, retry: retryable }
    }
    if (!finish) return { value: loaded.value as R, retry: false }
    const value = await finish(loaded.value, candidate.origin, retry)
    if (value !== undefined) return { value, retry: false }
    return { value: undefined, retry: !retry && shouldRetryFinish(loaded.value) }
  }

  type Input<R> = {
    items: ConfigPlugin.Origin[]
    kind: PluginKind
    wait?: () => Promise<void>
    finish?: (load: Loaded, origin: ConfigPlugin.Origin, retry: boolean) => Promise<R | undefined>
    missing?: (value: Missing, origin: ConfigPlugin.Origin, retry: boolean) => Promise<R | undefined>
    report?: Report
  }

  export async function loadExternal<R = Loaded>(input: Input<R>): Promise<R[]> {
    const candidates = input.items.map((origin) => ({ origin, plan: plan(origin.spec) }))
    const list: Array<Promise<Attempt<R>>> = []
    for (const candidate of candidates) {
      list.push(attempt(candidate, input.kind, false, input.finish, input.missing, input.report))
    }
    const out = await Promise.all(list)
    if (input.wait && out.some((item) => item.retry)) {
      await input.wait().catch(() => undefined)
      for (let index = 0; index < candidates.length; index++) {
        if (!out[index].retry) continue
        out[index] = await attempt(candidates[index], input.kind, true, input.finish, input.missing, input.report)
      }
    }
    const ready: R[] = []
    for (const item of out) if (item.value !== undefined) ready.push(item.value)
    return ready
  }
}
