/**
 * Sends build log chunks one call at a time, joining the chunks that arrive while a call is
 * out, so they reach the workspace in order. See docs/protocol.md `build`.
 */
export class LogForwarder {
  private queued = "";
  private sending = false;
  private pumping: Promise<void> = Promise.resolve();
  private stopped = false;

  /** `onStop` sees the error of the first failed call, after which nothing more is sent. */
  constructor(
    private readonly send: (chunk: string) => Promise<unknown>,
    private readonly onStop: (error: unknown) => void = () => {},
  ) {}

  push(chunk: string): void {
    if (this.stopped) return;
    this.queued += chunk;
    if (this.sending) return;
    this.sending = true;
    this.pumping = this.pump();
  }

  /** Resolves once every chunk pushed so far has been sent or dropped. */
  async drain(): Promise<void> {
    while (this.sending) await this.pumping;
  }

  private async pump(): Promise<void> {
    try {
      while (this.queued && !this.stopped) {
        const chunk = this.queued;
        this.queued = "";
        try {
          await this.send(chunk);
        } catch (e) {
          this.stopped = true;
          this.queued = "";
          this.onStop(e);
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
