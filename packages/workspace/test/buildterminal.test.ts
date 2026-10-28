import { describe, expect, test } from "bun:test";
import { PendingWrites } from "../src/buildterminal";

describe("PendingWrites", () => {
  test("holds writes until open, then passes them on in order", () => {
    const fired: string[] = [];
    const writes = new PendingWrites((text) => fired.push(text));
    writes.write("a");
    writes.write("b");
    expect(fired).toEqual([]);
    writes.open();
    writes.write("c");
    expect(fired).toEqual(["a", "b", "c"]);
  });
});
