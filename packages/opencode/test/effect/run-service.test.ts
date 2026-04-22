import { expect, test } from "bun:test"
import { Effect, Layer, Context } from "effect"
import { makeRuntime } from "../../src/effect/run-service"
import { Context as UtilContext } from "../../src/util"

class Shared extends Context.Service<Shared, { readonly id: number }>()("@test/Shared") { }

test("makeRuntime shares dependent layers through the shared memo map", async () => {
  let n = 0

  const shared = Layer.effect(
    Shared,
    Effect.sync(() => {
      n += 1
      return Shared.of({ id: n })
    }),
  )

  class One extends Context.Service<One, { readonly get: () => Effect.Effect<number> }>()("@test/One") { }
  const one = Layer.effect(
    One,
    Effect.gen(function* () {
      const svc = yield* Shared
      return One.of({
        get: Effect.fn("One.get")(() => Effect.succeed(svc.id)),
      })
    }),
  ).pipe(Layer.provide(shared))

  class Two extends Context.Service<Two, { readonly get: () => Effect.Effect<number> }>()("@test/Two") { }
  const two = Layer.effect(
    Two,
    Effect.gen(function* () {
      const svc = yield* Shared
      return Two.of({
        get: Effect.fn("Two.get")(() => Effect.succeed(svc.id)),
      })
    }),
  ).pipe(Layer.provide(shared))

  const { runPromise: runOne } = makeRuntime(One, one)
  const { runPromise: runTwo } = makeRuntime(Two, two)

  expect(await runOne((svc) => svc.get())).toBe(1)
  expect(await runTwo((svc) => svc.get())).toBe(1)
  expect(n).toBe(1)
})

test("makeRuntime provides a runtime context override", async () => {
  class CurrentContext extends Context.Service<CurrentContext, { readonly get: () => Effect.Effect<string> }>()("@test/CurrentContext") { }

  const layer = Layer.effect(
    CurrentContext,
    Effect.gen(function* () {
      const context = yield* UtilContext.Service
      return CurrentContext.of({
        get: () => Effect.succeed(context.kind),
      })
    }),
  )

  const { runPromise } = makeRuntime(CurrentContext, layer, {
    ...UtilContext.defaultContext,
    kind: "remote",
    endpoint: "sandbox://test",
  })

  expect(await runPromise((svc) => svc.get())).toBe("remote")
})
