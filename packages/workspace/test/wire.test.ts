import { describe, expect, test } from "bun:test";
import { encodeFrame, encodeRequest, LineDecoder, type Frame } from "../src/wire";

describe("encoding", () => {
  test("a request is one newline-terminated JSON line", () => {
    const s = encodeRequest({ action: "build", profile: "development" });
    expect(s.endsWith("\n")).toBe(true);
    expect(JSON.parse(s.trim())).toEqual({ action: "build", profile: "development" });
  });

  test("a frame round-trips", () => {
    const frame: Frame = { kind: "log", line: "bun install v1.4.3" };
    expect(JSON.parse(encodeFrame(frame).trim())).toEqual(frame);
  });
});

describe("LineDecoder", () => {
  test("yields one value per complete line and holds the partial tail", () => {
    const d = new LineDecoder<Frame>();
    expect(d.feed('{"kind":"log","line":"a"}\n{"kind":"log","li')).toEqual([
      { kind: "log", line: "a" },
    ]);
    expect(d.feed('ne":"b"}\n')).toEqual([{ kind: "log", line: "b" }]);
  });

  test("skips blank lines", () => {
    const d = new LineDecoder<Frame>();
    expect(d.feed('\n\n{"kind":"log","line":"x"}\n')).toEqual([{ kind: "log", line: "x" }]);
  });

  test("streams many log frames then a final response (build streaming shape)", () => {
    const d = new LineDecoder<Frame>();
    const wire =
      encodeFrame({ kind: "log", line: "PREBUILD" }) +
      encodeFrame({ kind: "log", line: "done" }) +
      encodeFrame({
        kind: "response",
        response: {
          ok: true,
          result: {
            artifactRel: ".tmp/expo-bridge/a.tar.gz",
            logRel: ".tmp/expo-bridge/b.log",
            exitCode: 0,
          },
        },
      });
    const frames = d.feed(wire);
    expect(frames.filter((f) => f.kind === "log")).toHaveLength(2);
    const last = frames[frames.length - 1]!;
    expect(last.kind).toBe("response");
  });
});
