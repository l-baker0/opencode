import { Observability } from "./observability"
import { Layer, type Context, ManagedRuntime, type Effect } from "effect"
import { memoMap } from "./memo-map"
import { Context as UtilContext } from "@/util"

export function makeRuntime<I, S, E, R = never>(
  service: Context.Service<I, S>,
  layer: Layer.Layer<I, E, R>,
  context: UtilContext.AnyContext = UtilContext.defaultContext,
) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  const runtimeLayer = Layer.provideMerge(Layer.provideMerge(layer, Layer.succeed(UtilContext.Service, context)), Observability.layer) as Layer.Layer<
    I,
    E
  >
  const getRuntime = () => (rt ??= ManagedRuntime.make(runtimeLayer, { memoMap }))

  return {
    runSync: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => getRuntime().runSync(service.use(fn)),
    runPromiseExit: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) =>
      getRuntime().runPromiseExit(service.use(fn), options),
    runPromise: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) =>
      getRuntime().runPromise(service.use(fn), options),
    runFork: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => getRuntime().runFork(service.use(fn)),
    runCallback: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => getRuntime().runCallback(service.use(fn)),
  }
}
