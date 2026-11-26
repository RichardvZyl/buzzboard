import { afterEach, describe, expect, it, vi } from "vitest";
import { Relay } from "./relay";
import type { Signer, SignedEvent } from "./nostr";

afterEach(() => vi.unstubAllGlobals());

describe("managed board writes", () => {
  it("signs the managed command and never falls back to raw event writes", async () => {
    const sign = vi.fn().mockResolvedValue("Nostr test-signature");
    const relay = new Relay("https://relay.example", { nip98Header: sign } as unknown as Signer);
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 403 }));
    vi.stubGlobal("fetch", fetch);

    await expect(relay.command("ticket.move", { ticketId: "ticket-id", column: "done" }))
      .rejects.toThrow("403");
    const [[url, options]] = fetch.mock.calls;
    expect(url).toBe("https://relay.example/board/commands");
    expect(sign).toHaveBeenCalledWith("POST", url, options.body);
    expect(JSON.parse(options.body)).toMatchObject({
      version: 1, requestId: expect.any(String), operation: "ticket.move",
      input: { ticketId: "ticket-id", column: "done" },
    });
    await expect(relay.submit({ kind: 1631 } as SignedEvent)).rejects.toThrow("disabled");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("includes the server's detail and recovery action for a rejected legacy write", async () => {
  const sign = vi.fn().mockResolvedValue("Nostr test-signature");
  const relay = new Relay("https://relay.example", { nip98Header: sign } as unknown as Signer);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: false,
    code: "legacy_ticket_missing_issue",
    error: "The ticket has no linked GitHub issue.",
    resolution: "Link an issue in the lane repository.",
  }), { status: 409 })));
  await expect(relay.command("ticket.move", { ticketId: "ticket-id" })).rejects.toThrow(
    /ticket\.move failed \[request .*HTTP 409 legacy_ticket_missing_issue: The ticket has no linked GitHub issue\. Resolution: Link an issue in the lane repository\. Agent guide: .*AGENT-GUIDE\.md/,
  );
});
