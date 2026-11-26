// HTTP client for the buzz relay bridge (POST /query, POST /events),
// mirroring buzz-cli: ws(s):// normalized to http(s)://, per-request NIP-98.

import type { Signer, SignedEvent } from "./nostr.ts";

export function normalizeRelayUrl(url: string): string {
  let base = url.trim().replace(/\/+$/, "");
  if (base.startsWith("ws://")) base = `http://${base.slice(5)}`;
  else if (base.startsWith("wss://")) base = `https://${base.slice(6)}`;
  else if (!/^https?:\/\//.test(base)) base = `https://${base}`;
  return base;
}

export class Relay {
  private readonly base: string;
  private readonly signer: Signer;

  constructor(url: string, signer: Signer) {
    this.base = normalizeRelayUrl(url);
    this.signer = signer;
  }

  private async post(path: string, payload: unknown): Promise<Response> {
    const url = `${this.base}${path}`;
    const body = JSON.stringify(payload);
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: await this.signer.nip98Header("POST", url, body),
        "Content-Type": "application/json",
      },
      body,
    });
  }

  async query(filters: Record<string, unknown>[]): Promise<SignedEvent[]> {
    return (await this.queryWithCompleteness(filters)).events;
  }

  async queryWithCompleteness(filters: Record<string, unknown>[]) {
    const resp = await this.post("/query", filters);
    if (!resp.ok) {
      throw new Error(`query failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    }
    return {
      events: (await resp.json()) as SignedEvent[],
      complete: resp.headers.get("X-BuzzBoard-Query-Complete") === "true",
    };
  }

  async command(operation: string, input: Record<string, unknown>): Promise<void> {
    const requestId = crypto.randomUUID();
    const guide = "https://github.com/RichardvZyl/buzzboard/blob/04d569333f99fd84b702e210f844cff4dc44e0c3/AGENT-GUIDE.md";
    const failure = (detail: string, resolution: string) => new Error(
      `${operation} failed [request ${requestId}]: ${detail} Resolution: ${resolution} Agent guide: ${guide}`,
    );

    let response: Response;
    let text: string;
    try {
      response = await this.post("/board/commands", { version: 1, requestId, operation, input });
      text = await response.text();
    } catch (cause) {
      throw failure(String(cause), "Check relay connectivity. Run buzz-board.mjs request-status with the request ID and the same identity before retrying.");
    }

    let result: { ok?: boolean; code?: string; error?: string; resolution?: string } | undefined;
    try { result = JSON.parse(text); } catch { /* The HTTP status still identifies the failure. */ }
    if (response.ok && result?.ok === true) return;

    const code = typeof result?.code === "string" ? ` ${result.code}` : "";
    const message = typeof result?.error === "string" ? result.error : text.trim() || "No confirmation returned.";
    const resolution = typeof result?.resolution === "string" && result.resolution.trim()
      ? result.resolution : "Check the ticket and lane prerequisites. If the outcome is unclear, run buzz-board.mjs request-status with the request ID before retrying.";
    throw failure(`HTTP ${response.status}${code}: ${message.slice(0, 1200)}`, resolution);
  }

  async submit(event: SignedEvent): Promise<unknown> {
    throw new Error(`Direct writes of event kind ${event.kind} are disabled. Use a managed board command.`);
  }
}
