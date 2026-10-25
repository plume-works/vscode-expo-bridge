// One `BuildCache.store` in its own process, as a second VS Code window's host extension
// would run it. Args: storage host folder key builtAt artifact holdMs
import { realRunner } from "../../src/exec";
import { BuildCache } from "../../src/buildcache";

const [storage, host, folder, key, builtAt, artifact, holdMs] = process.argv.slice(2);
const hold = Number(holdMs);
const cache = new BuildCache(storage!, host!, folder!, {
  runner: realRunner,
  env: { PATH: process.env.PATH ?? "" },
  tar: "tar",
  lock: hold ? { whileLocked: () => new Promise((r) => setTimeout(r, hold)) } : {},
});
const stored = await cache.store(key!, artifact!, Number(builtAt));
process.stdout.write(stored ? "stored\n" : "refused\n");
