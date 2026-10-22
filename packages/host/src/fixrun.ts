/** Runs one shell command in the fix terminal; resolves with its exit code when known. */
export type RunCommand = (command: string) => Promise<number | undefined>;

/** Run a fix's commands in order, stopping at the first that exits non-zero. */
export async function runCommands(run: RunCommand, commands: string[]): Promise<boolean> {
  for (const command of commands) {
    const code = await run(command);
    if (code !== undefined && code !== 0) return false;
  }
  return true;
}

/** Lets one fix run at a time. */
export class FixGate {
  private active = false;

  get running(): boolean {
    return this.active;
  }

  /** Run `fix` unless another is running; false when it was refused. */
  async run(fix: () => Promise<void>): Promise<boolean> {
    if (this.active) return false;
    this.active = true;
    try {
      await fix();
    } finally {
      this.active = false;
    }
    return true;
  }
}
