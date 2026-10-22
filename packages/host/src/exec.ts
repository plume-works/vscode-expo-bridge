import { execFile } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a program with an argument array — never a shell string, so a crafted argument
 * cannot inject a command. Resolves even on a non-zero exit; the caller inspects `code`.
 */
export function run(
  file: string,
  args: string[],
  opts: RunOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        env: opts.env,
        cwd: opts.cwd,
        // A streamed build log can outgrow any fixed cap, and exceeding it kills the child.
        maxBuffer: opts.onOutput ? Infinity : 16 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number"
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (opts.onOutput) {
      child.stdout?.on("data", (d) => opts.onOutput!(String(d)));
      child.stderr?.on("data", (d) => opts.onOutput!(String(d)));
    }
  });
}

export interface RunOptions {
  env?: Record<string, string>;
  cwd?: string;
  /** Receives stdout and stderr chunks as they arrive, interleaved. */
  onOutput?: (chunk: string) => void;
}

/** The subset of process behavior the host actions need, so tests can stub it. */
export interface Runner {
  run(file: string, args: string[], opts?: RunOptions): Promise<ExecResult>;
}

export const realRunner: Runner = { run };
