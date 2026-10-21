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
  opts: { env?: Record<string, string>; cwd?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { env: opts.env, cwd: opts.cwd, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number"
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** The subset of process behavior the host actions need, so tests can stub it. */
export interface Runner {
  run(file: string, args: string[], opts?: { env?: Record<string, string>; cwd?: string }): Promise<ExecResult>;
}

export const realRunner: Runner = { run };
