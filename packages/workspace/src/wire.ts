import type { Response } from "@plume-works/expo-bridge-protocol";
import type { CliRequest } from "./cli-args";

/** Frames on the container socket: a log line while a build runs, then one final response. */
export type Frame = { kind: "log"; line: string } | { kind: "response"; response: Response };

export function encodeRequest(req: CliRequest): string {
  return JSON.stringify(req) + "\n";
}

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame) + "\n";
}

/**
 * A newline-delimited JSON decoder. Feed it chunks; it yields one parsed value per
 * complete line and keeps any partial tail for the next feed.
 */
export class LineDecoder<T> {
  private buffer = "";
  feed(chunk: string): T[] {
    this.buffer += chunk;
    const out: T[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim() !== "") out.push(JSON.parse(line) as T);
    }
    return out;
  }
}
