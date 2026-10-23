import { beforeEach, describe, expect, test } from "bun:test";
import type { BuildDecision, Prompts, SecretStore, TrustDecision } from "../src/trust";
import { BUILD_ANSWERS, TrustStore } from "../src/trust";

class FakeMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

class FakeSecrets implements SecretStore {
  private map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key);
  }
  async store(key: string, value: string) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

function prompts(trust: TrustDecision | undefined, build: BuildDecision | undefined): Prompts {
  return {
    trust: async () => trust,
    build: async () => build,
  };
}

const HOST = "/Users/me/app";
const OTHER = "/Users/me/other";

let state: FakeMemento;
let secrets: FakeSecrets;
let clock: number;

beforeEach(() => {
  state = new FakeMemento();
  secrets = new FakeSecrets();
  clock = 1_000_000;
});

describe("trust", () => {
  test("prompts once, then remembers an allow", async () => {
    let calls = 0;
    const p: Prompts = { trust: async () => (calls++, "allow"), build: async () => "once" };
    const store = new TrustStore(state, secrets, p, () => clock);
    expect(await store.ensureTrusted(HOST)).toBe(true);
    expect(await store.ensureTrusted(HOST)).toBe(true);
    expect(calls).toBe(1);
    expect(store.listTrusted()).toEqual([HOST]);
  });

  test("a declined workspace stays declined and never re-prompts", async () => {
    let calls = 0;
    const p: Prompts = { trust: async () => (calls++, "decline"), build: async () => "once" };
    const store = new TrustStore(state, secrets, p, () => clock);
    expect(await store.ensureTrusted(HOST)).toBe(false);
    expect(await store.ensureTrusted(HOST)).toBe(false);
    expect(calls).toBe(1);
    expect(store.listTrusted()).toEqual([]);
  });

  test("listDecisions includes declined workspaces so they can be revoked", async () => {
    let answer: TrustDecision = "allow";
    const p: Prompts = { trust: async () => answer, build: async () => "once" };
    const store = new TrustStore(state, secrets, p, () => clock);
    await store.ensureTrusted(HOST);
    answer = "decline";
    await store.ensureTrusted(OTHER);
    expect(store.listDecisions()).toEqual([
      { hostPath: HOST, decision: "allow" },
      { hostPath: OTHER, decision: "decline" },
    ]);
    await store.revoke(OTHER);
    answer = "allow";
    expect(await store.ensureTrusted(OTHER)).toBe(true);
  });

  test("a dismissed prompt (undefined) is treated as decline", async () => {
    const store = new TrustStore(state, secrets, prompts(undefined, "once"), () => clock);
    expect(await store.ensureTrusted(HOST)).toBe(false);
  });

  test("revoke clears trust so the next request prompts again", async () => {
    let answer: TrustDecision = "allow";
    const p: Prompts = { trust: async () => answer, build: async () => "once" };
    const store = new TrustStore(state, secrets, p, () => clock);
    await store.ensureTrusted(HOST);
    await store.revoke(HOST);
    expect(store.listTrusted()).toEqual([]);
    answer = "decline";
    expect(await store.ensureTrusted(HOST)).toBe(false);
  });
});

describe("build confirmation", () => {
  test("'once' never records a cooldown — every build re-prompts", async () => {
    let calls = 0;
    const p: Prompts = { trust: async () => "allow", build: async () => (calls++, "once") };
    const store = new TrustStore(state, secrets, p, () => clock);
    expect(await store.confirmBuild(HOST, "development")).toBe(true);
    expect(await store.confirmBuild(HOST, "development")).toBe(true);
    expect(calls).toBe(2);
  });

  test("'hour' suppresses the prompt for an hour, then it returns", async () => {
    let calls = 0;
    const p: Prompts = { trust: async () => "allow", build: async () => (calls++, "hour") };
    const store = new TrustStore(state, secrets, p, () => clock);
    expect(await store.confirmBuild(HOST, "development")).toBe(true);
    clock += 59 * 60 * 1000;
    expect(await store.confirmBuild(HOST, "development")).toBe(true);
    expect(calls).toBe(1);
    clock += 2 * 60 * 1000; // now past the hour
    expect(await store.confirmBuild(HOST, "development")).toBe(true);
    expect(calls).toBe(2);
  });

  test("a cooldown is scoped to one workspace", async () => {
    const p: Prompts = { trust: async () => "allow", build: async () => "hour" };
    const store = new TrustStore(state, secrets, p, () => clock);
    await store.confirmBuild(HOST, "development");
    let otherPrompted = false;
    const store2 = new TrustStore(
      state,
      secrets,
      {
        trust: async () => "allow",
        build: async () => ((otherPrompted = true), "once"),
      },
      () => clock,
    );
    await store2.confirmBuild(OTHER, "development");
    expect(otherPrompted).toBe(true);
  });

  test("declining the build confirmation fails the build", async () => {
    const store = new TrustStore(state, secrets, prompts("allow", "decline"), () => clock);
    expect(await store.confirmBuild(HOST, "development")).toBe(false);
  });

  test("an untrusted workspace fails the build before any confirmation", async () => {
    let buildPrompted = false;
    const p: Prompts = {
      trust: async () => "decline",
      build: async () => ((buildPrompted = true), "once"),
    };
    const store = new TrustStore(state, secrets, p, () => clock);
    expect(await store.confirmBuild(HOST, "development")).toBe(false);
    expect(buildPrompted).toBe(false);
  });
});

describe("token", () => {
  test("set, get, and clear the token in SecretStorage", async () => {
    const store = new TrustStore(state, secrets, prompts("allow", "once"), () => clock);
    expect(await store.getToken()).toBeUndefined();
    await store.setToken("abc");
    expect(await store.getToken()).toBe("abc");
    await store.clearToken();
    expect(await store.getToken()).toBeUndefined();
  });
});

describe("BUILD_ANSWERS", () => {
  test("every build confirmation answer says it allows the build", () => {
    expect(Object.values(BUILD_ANSWERS)).toEqual([
      "Allow once",
      "Allow and don't ask for an hour",
      "Allow and don't ask today",
    ]);
  });
});
