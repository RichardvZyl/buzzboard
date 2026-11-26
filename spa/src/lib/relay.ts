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
    const resp = await this.post("/query", filters);
    if (!resp.ok) {
      throw new Error(`query failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    }
    return (await resp.json()) as SignedEvent[];
  }

  async command(operation: string, input: Record<string, unknown>): Promise<void> {
    const response = await this.post("/board/commands", {
      version: 1, requestId: crypto.randomUUID(), operation, input,
    });
    if (!response.ok) throw new Error(`Board command failed (${response.status}): ${(await response.text()).slice(0, 300)} Agent guide: https://github.com/RichardvZyl/buzzboard/blob/codex/public-work/AGENT-GUIDE.md`);
    const result = await response.json();
    if (result?.ok !== true) throw new Error(result?.error || "Board command was not confirmed.");
  }

  async submit(event: SignedEvent): Promise<unknown> {
    throw new Error(`Direct writes of event kind ${event.kind} are disabled. Use a managed board command.`);
  }
}
