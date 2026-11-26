import { useEffect, useState } from "react";
import { COLUMNS, COLUMN_LABELS, type Column } from "./lib/kinds";
import {
  addBoardLinkToCanvas, assignCard, attachChannel, createCard, createLane, deleteLane,
  fetchMyChannels, fetchTicketComments, postTicketComment, githubSlug, laneBoardUrl, moveCard, saveCardDependencies, saveCardNotifications,
  type Agent, type Card, type Lane,
} from "./lib/board";
import {
  NOTIFY_AGENT_SLUGS, NOTIFY_EVENTS, upsertSubscription,
  type NotifyEvent, type NotifySubscription,
} from "./lib/notify";
import type { Session } from "./Board";
import { BotIcon, GithubIcon, XIcon } from "./Icons";

function Overlay({ children, close, wide = false }: { children: React.ReactNode; close: () => void; wide?: boolean }) {
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={wide ? "modal ticket-modal" : "modal"}>{children}</div>
    </div>
  );
}

function useAction(close: () => void, refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      close();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function NewCardModal({ lane, session, syncAgentName, spinFrom, close, refresh }: {
  lane: Lane; session: Session; syncAgentName?: string; spinFrom?: Card;
  close: () => void; refresh: () => Promise<void>;
}) {
  const [subject, setSubject] = useState(spinFrom ? `Follow-up: ${spinFrom.subject}` : "");
  const [body, setBody] = useState(
    spinFrom
      ? `Follow-up to "${spinFrom.subject}" (\`${spinFrom.id}\`).\n\nWhat's needed:\n`
      : "",
  );
  const [labels, setLabels] = useState("");
  const [needsTriage, setNeedsTriage] = useState(Boolean(spinFrom));
  const [closeOriginal, setCloseOriginal] = useState(Boolean(spinFrom));
  const { busy, error, run } = useAction(close, refresh);
  return (
    <Overlay close={close}>
      <h2>{spinFrom ? "Spin off a new ticket" : `New card in ${lane.name}`}</h2>
      {spinFrom && (
        <p className="muted">
          Cards are immutable — a sharper ticket replaces editing. The original stays
          linked via its id in the description.
        </p>
      )}
      {lane.syncAgent && (
        <p className="muted">This lane is GitHub-synced — the sync agent will be asked to mirror the card.</p>
      )}
      <form onSubmit={(e) => {
        e.preventDefault();
        const parsed = labels.split(",").map((l) => l.trim()).filter(Boolean);
        if (needsTriage && !parsed.some((l) => l.toLowerCase() === "triage")) {
          parsed.push("triage");
        }
        run(async () => {
          if (spinFrom && !session.demo) {
            await session.relay.command("ticket.spinOff", {
              ticketId: spinFrom.id, lane: lane.address, title: subject.trim(),
              body, labels: parsed, closeOriginal,
            });
            return;
          }
          await createCard(session.relay, session.signer, lane, subject.trim(), body,
            parsed, syncAgentName);
          if (spinFrom && closeOriginal) {
            await moveCard(session.relay, session.signer, lane, spinFrom, "closed",
              { before: null, after: null });
          }
        });
      }}>
        <input autoFocus required placeholder="Title" value={subject}
               onChange={(e) => setSubject(e.target.value)} />
        <textarea rows={5} placeholder="Description (markdown)" value={body}
                  onChange={(e) => setBody(e.target.value)} />
        <input placeholder="labels, comma-separated" value={labels}
               onChange={(e) => setLabels(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={needsTriage}
                 onChange={(e) => setNeedsTriage(e.target.checked)} />
          Needs triage — start in the Triage column until someone accepts it
        </label>
        {spinFrom && (
          <label className="check">
            <input type="checkbox" checked={closeOriginal}
                   onChange={(e) => setCloseOriginal(e.target.checked)} />
            Close the original card
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button type="button" className="ghost" onClick={close}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
    </Overlay>
  );
}

function TicketComments({ card, session, nameOf }: Pick<Parameters<typeof CardModal>[0], "card" | "session" | "nameOf">) {
  const [comments, setComments] = useState<Awaited<ReturnType<typeof fetchTicketComments>>>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchTicketComments(session.relay, card.id).then(
      (events) => { if (active) setComments(events); },
      (reason: unknown) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [session.relay, card.id]);

  async function post() {
    setBusy(true);
    setError("");
    try {
      const comment = await postTicketComment(session.relay, session.signer, card, draft);
      if (comment) {
        setComments((previous) => previous.some((event) => event.id === comment.id)
          ? previous : [...previous, comment]);
      } else {
        setComments(await fetchTicketComments(session.relay, card.id));
      }
      setDraft("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ticket-comments" aria-labelledby="ticket-comments-heading">
      <h3 id="ticket-comments-heading">Comments</h3>
      <div className="ticket-scroll" tabIndex={0} role="region" aria-labelledby="ticket-comments-heading">
        {comments.map((comment) => (
          <article key={comment.id}>
            <strong>{nameOf(comment.pubkey)}</strong>
            <pre className="body">{comment.content}</pre>
          </article>
        ))}
        {!comments.length && !error && <p className="muted">No comments yet.</p>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void post(); }}>
        <label>New comment
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} />
        </label>
        <button disabled={busy || !draft.trim()}>Post comment</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}

function ReviewPane({ card }: { card: Card }) {
  const report = card.reviewReport;
  const pullRequestPattern = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*(?=$|[\s)\]>.,;!?#/`*])/gi;
  const pullRequests = [...new Set([...(`${report ?? ""}\n${card.body}`).matchAll(pullRequestPattern)]
    .map(([url]) => url))];

  return (
    <section className="review-pane" aria-labelledby="card-review-heading">
      <h3 id="card-review-heading">Review</h3>
      {pullRequests.length > 0 ? (
        <ul>
          {pullRequests.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {url.replace(/^https:\/\/github\.com\//i, "").replace("/pull/", " #")}
              </a>
              <a href={`${url}/files`} target="_blank" rel="noreferrer">Files changed</a>
              <a href={`${url}/checks`} target="_blank" rel="noreferrer">Checks</a>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No pull request linked. Include its GitHub URL in the review update.</p>}
      <h4>Review update</h4>
      {report
        ? <pre className="body">{report}</pre>
        : <p className="muted">No verification notes were included in the review update.</p>}
    </section>
  );
}

export function CardModal({ card, lane, session, agents, nameOf, onDemoThread, onSpinOff, close, refresh }: {
  card: Card; lane: Lane; session: Session;
  agents: (Agent & { inChannel: boolean })[];
  nameOf: (pk: string | null | undefined) => string;
  onDemoThread?: (card: Card) => void;
  onSpinOff: () => void;
  close: () => void; refresh: () => Promise<void>;
}) {
  const [column, setColumn] = useState<Column>(card.column);
  const [purposeTitle, setPurposeTitle] = useState(card.subject);
  const [purposeBody, setPurposeBody] = useState(card.body);
  const [dependencies, setDependencies] = useState((card.dependencies ?? []).join(", "));
  const canEditDependencies = [card.author, lane.owner, ...(lane.maintainers ?? [])].includes(session.signer.pubkey);
  const [assignee, setAssignee] = useState(card.assignee ?? "");
  const [dispatch, setDispatch] = useState(true);
  const [notifyOpen, setNotifyOpen] = useState(card.notifications.length > 0);
  const [notifySubs, setNotifySubs] = useState<NotifySubscription[]>(card.notifications);
  const [notifySlug, setNotifySlug] = useState<string>(NOTIFY_AGENT_SLUGS[0]);
  const [notifyEvents, setNotifyEvents] = useState<Set<NotifyEvent>>(new Set());
  const { busy, error, run } = useAction(close, refresh);
  const canDispatch = Boolean(lane.channelId);

  const editNotifyAgent = (slug: string) => {
    setNotifySlug(slug);
    const existing = notifySubs.find((s) => s.agentSlug === slug);
    setNotifyEvents(new Set(existing?.events ?? []));
  };

  const toggleNotifyEvent = (ev: NotifyEvent) => {
    setNotifyEvents((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
  };

  return (
    <Overlay close={close} wide>
      <div className="modal-head">
        <h2>{card.subject}</h2>
        <button className="icon-btn" onClick={close} title="Close"><XIcon /></button>
      </div>
      <p className="muted mono">{card.id.slice(0, 16)}… · {lane.name} · by {nameOf(card.author)}</p>

      {card.blocked && (
        <div className="notice">
          <strong>⚠ The agent is blocked</strong> and needs your input.{" "}
          {card.threadLink && (<>Read its report and reply in{" "}
            {onDemoThread
              ? <a href="#thread" onClick={(e) => { e.preventDefault(); onDemoThread(card); }}>the Buzz thread</a>
              : <a href={card.threadLink}>the Buzz thread</a>}{" — "}</>)}
          or{" "}
          <a href="#spin-off" onClick={(e) => { e.preventDefault(); onSpinOff(); }}>
            spin the ask into a new ticket
          </a>, or move this card back to Backlog.
        </div>
      )}
      <div className="ticket-panes">
        <section className="ticket-details" aria-labelledby="ticket-description-heading">
          <h3 id="ticket-description-heading">Description</h3>
          <div className="ticket-scroll" tabIndex={0} role="region" aria-labelledby="ticket-description-heading">
            {card.body ? <pre className="body">{card.body}</pre> : <p className="muted">No description.</p>}
            {card.column === "in_review" && <ReviewPane card={card} />}
          </div>
        </section>
        <TicketComments key={card.id} card={card} session={session} nameOf={nameOf} />
      </div>
      {card.threadLink && !card.blocked && (
        <p>
          {onDemoThread
            ? <a href="#thread" onClick={(e) => { e.preventDefault(); onDemoThread(card); }}>💬 Open the agent thread</a>
            : <a href={card.threadLink}>💬 Open the agent thread in Buzz</a>}
        </p>
      )}
      {!session.demo && (
        <details>
          <summary>Edit ticket title and context</summary>
          <form onSubmit={(event) => {
            event.preventDefault();
            void run(() => session.relay.command("ticket.setPurpose", {
              ticketId: card.id, title: purposeTitle.trim(), body: purposeBody,
            }));
          }}>
            <label>Title <input required value={purposeTitle} onChange={(event) => setPurposeTitle(event.target.value)} /></label>
            <label>Context <textarea value={purposeBody} onChange={(event) => setPurposeBody(event.target.value)} /></label>
            <button disabled={busy || !purposeTitle.trim()}>Save ticket</button>
          </form>
        </details>
      )}
      {card.githubIssueUrl && (
        <p className="inline-link"><GithubIcon />
          <a href={card.githubIssueUrl} target="_blank" rel="noreferrer">Mirrored GitHub issue</a>
        </p>
      )}

      <div className="row">
        <label>
          Column
          <select value={column} onChange={(e) => setColumn(e.target.value as Column)}>
            {COLUMNS.map((c) => <option key={c} value={c}>{COLUMN_LABELS[c]}</option>)}
          </select>
        </label>
        <button disabled={busy || column === card.column || Boolean(card.unmetDependencies?.length)}
                onClick={() => run(() => moveCard(session.relay, session.signer, lane, card,
                  column, { before: null, after: null }))}>
          Move
        </button>
      </div>

      {Boolean(card.unmetDependencies?.length) && <p className="notice">{card.unverifiedDependencies?.length ? "Blocked because dependency completion could not be verified." : "Blocked by unfinished ticket dependencies."}</p>}
      {(canEditDependencies || Boolean(card.dependencies?.length)) && (
        <div className="row">
          <label>Depends on
            <input value={dependencies} onChange={(event) => setDependencies(event.target.value)}
              placeholder="Ticket IDs, comma-separated" disabled={!canEditDependencies || busy} />
          </label>
          {canEditDependencies && <button type="button" disabled={busy}
            onClick={() => run(() => saveCardDependencies(session.relay, session.signer, lane, card, dependencies))}>
            Save dependencies
          </button>}
        </div>
      )}
      {!card.blocked && (
        <p className="muted">
          Need a sharper version of this ticket?{" "}
          <a href="#spin-off" onClick={(e) => { e.preventDefault(); onSpinOff(); }}>
            Spin off a new one
          </a>{" "}
          (cards are immutable).
        </p>
      )}

      <div className="row">
        <label>
          Assignee
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">— unassigned —</option>
            {agents.map((a) => (
              <option key={a.pubkey} value={a.pubkey}>
                {a.name} · {a.pubkey.slice(0, 8)}{a.inChannel ? "" : "  ⚠ not in lane channel"}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}
                onClick={() => run(() => assignCard(session.relay, session.signer, lane, card,
                  assignee, nameOf(assignee), dispatch && canDispatch,
                  nameOf(session.signer.pubkey) || session.signer.pubkey.slice(0, 8)))}>
          Assign
        </button>
      </div>
      {session.demo && <label className="check">
        <input type="checkbox" checked={dispatch} disabled={!canDispatch}
               onChange={(e) => setDispatch(e.target.checked)} />
        Post assignment message in the lane channel (wakes the agent)
        {!canDispatch && <span className="error-inline"> — lane has no channel</span>}
      </label>}

      <fieldset className="notify-box">
        <legend>
          <label className="check">
            <input type="checkbox" checked={notifyOpen}
                   onChange={(e) => setNotifyOpen(e.target.checked)} />
            Notify agents
          </label>
        </legend>
        {notifyOpen && (
          <>
            <p className="muted">
              Subscriptions live on the card. Matching column moves, assignee
              changes and comments fan out on the lane channel; the host CLI
              also delivers through the A2A front door (Delegation Bot via :8122).
            </p>
            {notifySubs.length > 0 && (
              <ul className="notify-list">
                {notifySubs.map((s) => (
                  <li key={s.agentSlug}>
                    <strong>{s.agentSlug}</strong>
                    <span className="muted"> — {s.events.join(", ")}</span>
                    <button type="button" className="ghost" disabled={busy}
                            onClick={() => editNotifyAgent(s.agentSlug)}>Edit</button>
                    <button type="button" className="ghost" disabled={busy}
                            onClick={() => setNotifySubs(upsertSubscription(notifySubs, s.agentSlug, []))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row">
              <label>
                Agent
                <select value={notifySlug} onChange={(e) => editNotifyAgent(e.target.value)}>
                  {NOTIFY_AGENT_SLUGS.map((slug) => (
                    <option key={slug} value={slug}>{slug}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="notify-events">
              {NOTIFY_EVENTS.map((ev) => (
                <label key={ev} className="check">
                  <input type="checkbox" checked={notifyEvents.has(ev)}
                         onChange={() => toggleNotifyEvent(ev)} />
                  {ev}
                </label>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="ghost" disabled={busy || notifyEvents.size === 0}
                      onClick={() => setNotifySubs(
                        upsertSubscription(notifySubs, notifySlug, [...notifyEvents]),
                      )}>
                Stage agent
              </button>
              <button type="button" disabled={busy}
                      onClick={() => run(() => saveCardNotifications(
                        session.relay, session.signer, lane, card, notifySubs,
                      ))}>
                Save notifications
              </button>
            </div>
          </>
        )}
      </fieldset>

      {error && <div className="error">{error}</div>}
    </Overlay>
  );
}

export function NewLaneModal({ session, agents, close, refresh }: {
  session: Session; agents: Agent[]; close: () => void; refresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [staff, setStaff] = useState<Set<string>>(new Set());
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncAgent, setSyncAgent] = useState("");
  const { busy, error, run } = useAction(close, refresh);
  const githubLinked = Boolean(githubSlug(githubUrl.trim() || ""));
  const syncing = githubLinked && syncEnabled && syncAgent;
  return (
    <Overlay close={close}>
      <h2>New swimlane</h2>
      <p className="muted">
        {session.demo ? "Creates a simulated lane and discussion channel."
          : "Creates the lane, a dedicated private GitHub repository, and a discussion channel."}
      </p>
      <form onSubmit={(e) => {
        e.preventDefault();
        // the sync agent must be in the lane channel to receive its duties
        const staffed = syncing ? new Set(staff).add(syncAgent) : staff;
        run(() => createLane(session.relay, session.signer, name.trim(), description.trim(),
          githubUrl.trim(), [...staffed], null, window.location.origin,
          syncing ? syncAgent : null,
          syncing ? agents.find((a) => a.pubkey === syncAgent)?.name : undefined));
      }}>
        <input autoFocus required placeholder="Lane name" value={name}
               onChange={(e) => setName(e.target.value)} />
        <input placeholder="Description (optional)" value={description}
               onChange={(e) => setDescription(e.target.value)} />
        {session.demo && <input placeholder="GitHub repo URL (optional)" value={githubUrl}
               onChange={(e) => setGithubUrl(e.target.value)} />}
        {githubLinked && (
          <fieldset>
            <legend>GitHub sync</legend>
            <label className="check">
              <input type="checkbox" checked={syncEnabled}
                     onChange={(e) => setSyncEnabled(e.target.checked)} />
              Ask an agent to keep GitHub issues in sync with this lane
            </label>
            {syncEnabled && (
              <>
                <select value={syncAgent} onChange={(e) => setSyncAgent(e.target.value)}>
                  <option value="">— pick the sync agent —</option>
                  {agents.map((a) => (
                    <option key={a.pubkey} value={a.pubkey}>{a.name} · {a.pubkey.slice(0, 8)}</option>
                  ))}
                </select>
                <p className="muted">
                  The agent mirrors cards to GitHub issues and back using its own machine's
                  `gh` login — the board never stores a GitHub token. It'll be added to the
                  lane channel and briefed there.
                </p>
              </>
            )}
          </fieldset>
        )}
        {agents.length > 0 && (
          <fieldset>
            <legend>Staff the lane (adds agents to its channel)</legend>
            {agents.map((a) => (
              <label key={a.pubkey} className="check">
                <input type="checkbox" checked={staff.has(a.pubkey)}
                       onChange={(e) => {
                         const next = new Set(staff);
                         if (e.target.checked) next.add(a.pubkey); else next.delete(a.pubkey);
                         setStaff(next);
                       }} />
                <span className="agent-name"><BotIcon />{a.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button type="button" className="ghost" onClick={close}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create lane"}</button>
        </div>
      </form>
    </Overlay>
  );
}

export function DeleteLaneModal({ lane, cardCount, session, close, refresh }: {
  lane: Lane; cardCount: number; session: Session; close: () => void; refresh: () => Promise<void>;
}) {
  const [confirmName, setConfirmName] = useState("");
  const { busy, error, run } = useAction(close, refresh);
  return (
    <Overlay close={close}>
      <h2>Delete {lane.name}?</h2>
      <p className="muted">
        This publishes a deletion request for the lane{cardCount > 0
          ? ` and hides its ${cardCount} card${cardCount === 1 ? "" : "s"} from the board`
          : ""}. It relies on the relay honoring NIP-09 deletes — this app will stop
        showing the lane regardless, but the underlying events may still exist on the relay.
        This can't be undone from here.
      </p>
      <label>
        Type <strong>{lane.name}</strong> to confirm
        <input autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button type="button" className="ghost" onClick={close}>Cancel</button>
        <button className="pill warn" disabled={busy || confirmName !== lane.name}
                onClick={() => run(() => deleteLane(session.relay, session.signer, lane))}>
          {busy ? "Deleting…" : "Delete lane"}
        </button>
      </div>
    </Overlay>
  );
}

export function DemoThreadModal({ card, nameOf, close }: {
  card: Card; nameOf: (pk: string | null | undefined) => string; close: () => void;
}) {
  const agent = nameOf(card.assignee) || "the agent";
  return (
    <Overlay close={close}>
      <div className="modal-head">
        <h2>Agent thread <span className="muted">(demo)</span></h2>
        <button className="icon-btn" onClick={close} title="Close"><XIcon /></button>
      </div>
      <div className="thread">
        <div className="msg me">
          <span className="who">Ada</span>
          @{agent} you've been assigned: <strong>{card.subject}</strong> — read it, report
          progress in this thread, move the card as you go.
        </div>
        <div className="msg">
          <span className="who"><BotIcon />{agent}</span>
          {card.blocked
            ? <>I'm blocked: I need a decision from you before I can continue — see the card.
                I've set the status to draft so the board flags it.</>
            : <>Claimed. I'll set the card to In Progress while I work and to In Review when
                it's ready for your sign-off.</>}
        </div>
      </div>
      <div className="explain">
        In the real app this button deep-links into the <strong>Buzz desktop app</strong> at
        this exact thread (<code>buzz://message?…</code>). There you'd read the agent's full
        report and reply to {card.blocked ? "unblock it — it resumes and moves the card itself"
        : "steer it — every status change you see here is the agent publishing signed events"}.
        In demo mode the "agent" is a local simulation, so there's no thread to open.
      </div>
    </Overlay>
  );
}

export function AttachChannelModal({ lane, session, close, refresh }: {
  lane: Lane; session: Session; close: () => void; refresh: () => Promise<void>;
}) {
  const [channels, setChannels] = useState<{ uuid: string; name: string }[] | null>(null);
  const [choice, setChoice] = useState("");
  const { busy, error, run } = useAction(close, refresh);
  useEffect(() => {
    fetchMyChannels(session.relay, session.signer.pubkey)
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [session]);
  return (
    <Overlay close={close}>
      <h2>Attach a channel to {lane.name}</h2>
      <p className="muted">
        Dispatch messages and agent threads for this lane will live in the chosen channel.
      </p>
      {channels === null ? <p className="muted">Loading channels…</p> : (
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">— pick a channel —</option>
          {channels.map((c) => <option key={c.uuid} value={c.uuid}>#{c.name}</option>)}
        </select>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button className="ghost" onClick={close}>Cancel</button>
        <button disabled={busy || !choice}
                onClick={() => run(async () => {
                  await attachChannel(session.relay, session.signer, lane, choice);
                  await addBoardLinkToCanvas(session.relay, session.signer, choice,
                    laneBoardUrl(window.location.origin, lane), lane.owner, lane.repoId);
                })}>
          Attach
        </button>
      </div>
    </Overlay>
  );
}
