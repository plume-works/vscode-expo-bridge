import { describe, expect, test } from "bun:test";
import { decodeHostPath } from "../src/hostpath";

describe("decodeHostPath", () => {
  test("decodes a dev-container+<hex JSON> authority", () => {
    const hex = Buffer.from(JSON.stringify({ hostPath: "/Users/me/app" }), "utf8").toString("hex");
    expect(decodeHostPath(`dev-container+${hex}`)?.hostPath).toBe("/Users/me/app");
  });

  test("falls back to the decoded string when it is not JSON", () => {
    const hex = Buffer.from("/Users/me/plain", "utf8").toString("hex");
    expect(decodeHostPath(`attached-container+${hex}`)?.hostPath).toBe("/Users/me/plain");
  });

  test("returns null without a '+'", () => {
    expect(decodeHostPath("localhost")).toBeNull();
  });

  test("returns null for empty decoded content", () => {
    expect(decodeHostPath("dev-container+")).toBeNull();
  });
});
