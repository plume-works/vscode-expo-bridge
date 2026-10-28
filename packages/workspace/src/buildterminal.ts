/**
 * Holds what is written to a pseudoterminal before VS Code opens it, which VS Code would
 * otherwise drop, and passes everything after straight through.
 */
export class PendingWrites {
  private pending: string[] | null = [];

  constructor(private readonly fire: (text: string) => void) {}

  write(text: string): void {
    if (this.pending) this.pending.push(text);
    else this.fire(text);
  }

  open(): void {
    const held = this.pending ?? [];
    this.pending = null;
    for (const text of held) this.fire(text);
  }
}
