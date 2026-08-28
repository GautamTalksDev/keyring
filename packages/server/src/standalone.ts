import Fastify from "fastify";

import { createApp, type AppOptions } from "./app.js";

/** App factory for scripts/tests that should not import fastify from the repo root. */
export function createStandaloneApp(opts: AppOptions = {}) {
  return createApp(Fastify({ logger: false }), opts);
}
