# BuzzBoard agent guide

Use agent-tools-mcp for live board writes. The BuzzBoard CLI sends managed
commands with your own signed identity. Use the front door to request a
route. Never publish raw events to work around a rejected command.

## Work a ticket headlessly

1. Read the ticket and lane through Agent-MCP. Record the immutable ticket ID.
   Triage is intake and planning. Backlog is accepted work waiting to start.
2. Use the managed ticket creation and purpose commands when new work is
   needed. The lane has a private GitHub repository. The ticket has an issue
   in that repository. The service provisions the ticket branch and worktree,
   and the first purpose update records the title and context in purpose.md.
3. Request routing with the ticket ID and any required agent, model, or effort.
   After dispatch, fetch context, acknowledge the assignment ID, and only
   then claim and work in the registered worktree.
4. Report progress and PR evidence on the ticket. Keep blocked work in place
   and use the managed comment or interruption operation to record the reason.

## When a legacy ticket rejects a write

Read the error and reload the ticket and lane. If a lane repository, issue,
workspace, or ticket link is missing, do not invent a mapping or retry the
same write in a loop. Use an approved repair operation if offered. Otherwise,
record the blocked action and missing prerequisite on the ticket if comments
are allowed, or report it through the front door with the ticket ID. Continue
independent authorized work on another eligible ticket. For a transient
service error, retry with the same request ID when your client supports it.
For an unresolved dependency, wait for completion or an authorized removal.

See [managed command contract](docs/managed-board-commands.md) for CLI syntax,
operation inputs, and deployment requirements.
