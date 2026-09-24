# Team Chat, task assignment, and notification-bell changes

Drop these four files into the repo in place of the originals (paths match):

- `idms.html`
- `core.js`
- `server/routes/idms.js`
- `server/routes/rfqs.js`

No database migration is needed — everything reuses the existing generic
`idms_docs` table with new `kind` values (`notification`, `chat_thread`,
`chat_message`, `assigned_task`), the same pattern the app already uses for
NCRs, audits, and the DWM task list.

## What already existed (untouched)
- RFQ submission → bell notification/toast/badge inside the IDMS was already
  built (`t-bell`, RFQ Pipeline polling). Left as-is and extended, not replaced.
- The DWM "Task List" (shop-floor actions by name, no login required) is
  unchanged and still lives at `#s=task_list`.

## What's new
1. **Server** (`server/routes/idms.js`): `what=notif` (personal bell
   notifications, GET/POST/PATCH — filtered so a user only ever sees their
   own), `what=directory` (active usernames/roles, for assignee/chat
   pickers), `what=chat` (threads + messages, access restricted to a
   thread's own participant list, auto-notifies on new message).
2. **Server** (`server/routes/rfqs.js`): a new RFQ now also pushes a bell
   notification to every admin/developer user and opens a chat thread scoped
   to that RFQ automatically, alongside the existing email/WhatsApp alert.
3. **Client** (`core.js`): `Core.idms.notif`, `Core.idms.directory`,
   `Core.idms.chat` wrappers.
4. **Client** (`idms.html`):
   - New menu: **Team → Team Chat**, **Team → My Tasks**, and
     **Top Management → Team Task Completion** (management rollup).
   - **Team Chat**: start a conversation with anyone (incl. admin/developer
     admin), threaded messages, unread → bell.
   - **My Tasks**: assign a task to any login, with due date/priority.
     Lifecycle: Open → assignee marks **Completed** (notifies the assigner)
     → assigner **Accepts & closes** (notifies the assignee) — nothing closes
     itself. Includes a personal dashboard (pending, overdue, completed,
     on-time %).
   - **Team Task Completion**: the same figures rolled up per person, for
     management.
   - The bell now merges RFQ enquiries with chat/task notifications (icons,
     click-through to the right screen, "mark all read"), and polls every
     30s in addition to the existing 60s RFQ poll.
   - A one-time toast at sign-in surfaces overdue/upcoming tasks
     ("You have 2 overdue and 1 due this week — open My Tasks.").

## Known limits / things to check after deploy
- Chat participants and task assignees are drawn from `users` (active
  logins) only — there's no way yet to message someone who doesn't have a
  login.
- The bell polls rather than pushing in real time (consistent with the
  existing RFQ bell's design) — 30s for chat/tasks, 60s for RFQs.
- I verified `idms.html`'s inline script, `core.js`, and both server route
  files parse cleanly with `node --check`, but this hasn't been run against
  a live database — test sign-in, assigning a task to a second account, and
  sending a chat message before shipping to production.
