/**
 * Sends build log chunks one call at a time, joining the chunks that arrive while a call is
 * out, so they reach the workspace in order. See docs/protocol.md `build`.
 */
export class LogForwarder {
  private queued = "";
  private pumping: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly send: (chunk: string) => Promise<unknown>) {}

  push(chunk: string): void {
    if (this.stopped) return;
    this.queued += chunk;
    this.pumping ??= this.pump().finally(() => (this.pumping = null));
  }

  /** Resolves once every chunk pushed so far has been sent or dropped. */
  async drain(): Promise<void> {
    while (this.pumping) await this.pumping;
  }

  private async pump(): Promise<void> {
    while (this.queued && !this.stopped) {
      const chunk = this.queued;
      this.queued = "";
      try {
        await this.send(chunk);
      } catch {
        // A workspace extension without the command gets no stream; the log file stays whole.
        this.stopped = true;
        this.queued = "";
      }
    }
  }
}
