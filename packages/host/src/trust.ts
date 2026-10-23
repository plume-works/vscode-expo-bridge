// Per-workspace trust and the per-build confirmation. Keyed by host path, stored in the
// host extension's own globalState and SecretStorage — never read from any file the
// container can write. See docs/protocol.md for the model.

export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export type TrustDecision = "allow" | "decline";
export type BuildDecision = "once" | "hour" | "today" | "decline";

/** The build confirmation's buttons; each one allows the build. */
export const BUILD_ANSWERS: Record<Exclude<BuildDecision, "decline">, string> = {
  once: "Allow once",
  hour: "Allow and don't ask for an hour",
  today: "Allow and don't ask today",
};

/** Shown to the user; the caller maps the modal's buttons to these. */
export interface Prompts {
  trust(hostPath: string): Thenable<TrustDecision | undefined>;
  build(hostPath: string, profile: string): Thenable<BuildDecision | undefined>;
}

const TRUST_KEY = "expoBridge.trust"; // host path -> "allow" | "decline"
const COOLDOWN_KEY = "expoBridge.buildCooldown"; // host path -> epoch ms until which build is pre-approved
const TOKEN_KEY = "expoBridge.expoToken";

const HOUR_MS = 60 * 60 * 1000;

type TrustMap = Record<string, TrustDecision>;
type CooldownMap = Record<string, number>;

export class TrustStore {
  constructor(
    private readonly state: Memento,
    private readonly secrets: SecretStore,
    private readonly prompts: Prompts,
    private readonly now: () => number = Date.now,
  ) {}

  private trustMap(): TrustMap {
    return this.state.get<TrustMap>(TRUST_KEY) ?? {};
  }

  private cooldownMap(): CooldownMap {
    return this.state.get<CooldownMap>(COOLDOWN_KEY) ?? {};
  }

  listTrusted(): string[] {
    return Object.entries(this.trustMap())
      .filter(([, d]) => d === "allow")
      .map(([hostPath]) => hostPath);
  }

  /** Every recorded decision, allowed and declined, for the manage-trust command. */
  listDecisions(): { hostPath: string; decision: TrustDecision }[] {
    return Object.entries(this.trustMap()).map(([hostPath, decision]) => ({ hostPath, decision }));
  }

  async revoke(hostPath: string): Promise<void> {
    const map = this.trustMap();
    delete map[hostPath];
    await this.state.update(TRUST_KEY, map);
    const cd = this.cooldownMap();
    delete cd[hostPath];
    await this.state.update(COOLDOWN_KEY, cd);
  }

  /**
   * Ensure the workspace is trusted, prompting once for a workspace with no recorded
   * decision. A declined workspace stays declined until `revoke`, so it cannot re-prompt.
   */
  async ensureTrusted(hostPath: string): Promise<boolean> {
    const decision = this.trustMap()[hostPath];
    if (decision === "allow") return true;
    if (decision === "decline") return false;
    const answer = await this.prompts.trust(hostPath);
    const resolved: TrustDecision = answer === "allow" ? "allow" : "decline";
    const map = this.trustMap();
    map[hostPath] = resolved;
    await this.state.update(TRUST_KEY, map);
    return resolved === "allow";
  }

  /**
   * Gate a build: trust first, then a confirmation unless a live cooldown for this
   * workspace already covers it. "once" never records a cooldown; "hour"/"today" record
   * one scoped to this host path.
   */
  async confirmBuild(hostPath: string, profile: string): Promise<boolean> {
    if (!(await this.ensureTrusted(hostPath))) return false;
    const until = this.cooldownMap()[hostPath] ?? 0;
    if (until > this.now()) return true;

    const answer = await this.prompts.build(hostPath, profile);
    if (answer === undefined || answer === "decline") return false;
    if (answer === "hour" || answer === "today") {
      const span = answer === "hour" ? HOUR_MS : endOfTodayMs(this.now()) - this.now();
      const cd = this.cooldownMap();
      cd[hostPath] = this.now() + span;
      await this.state.update(COOLDOWN_KEY, cd);
    }
    return true;
  }

  getToken(): Thenable<string | undefined> {
    return this.secrets.get(TOKEN_KEY);
  }

  setToken(value: string): Thenable<void> {
    return this.secrets.store(TOKEN_KEY, value);
  }

  clearToken(): Thenable<void> {
    return this.secrets.delete(TOKEN_KEY);
  }
}

/** Milliseconds from the epoch to the end of the local day containing `now`. */
function endOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
