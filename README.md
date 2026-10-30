<div align="center">

# 🗂 session-ledger

**Every prompt, every command, every tool call your agent made — in one file per session.**

Append-only, harness-agnostic, and readable a year later without the tool that wrote it.

[![version](https://img.shields.io/badge/version-0.6.0-1d1d1f?style=flat-square)](package.json)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2018-3c873a?style=flat-square)](package.json)
[![tests](https://img.shields.io/badge/tests-43%20passing-1f8f4e?style=flat-square)](tests)
[![dependencies](https://img.shields.io/badge/dependencies-0-0071e3?style=flat-square)](package.json)
[![license](https://img.shields.io/badge/license-MIT-6e6e73?style=flat-square)](LICENSE)

<img src="docs/preview-dark.png" width="880" alt="A session-ledger page: session header with id, directory, timezone and stats; the user's prompt; a completed command with its test output; a failed command; a timed-out call with no result; a one-line footer.">

<sub>A real generated page. No JavaScript, no network requests, one dark theme.</sub>

<sub>[Install](#install) · [Harnesses](#harnesses) · [What gets written](#what-gets-written) · [Configuration](#configuration) · [CLI](#cli) · [Privacy](#privacy) · [Limits](#limits)</sub>

</div>

---

## Why this exists

Your agent already knows what it did. A month later, you don't.

Terminal scrollback is gone, chat history lives in a database you can't grep, and the
one thing you actually need — *what exactly did it run against production?* — was
never written down. session-ledger writes it down as it happens, in plain text you
can `cat`, `grep`, `diff` and commit.

| | |
| :--- | :--- |
| **Records** | 💬 prompts · shell commands · 🛠 every other tool and MCP call |
| **Writes** | one `.md` per session, plus a self-contained `.html` view |
| **Needs** | `node` ≥ 18. No SDK, no server, no build step, no dependencies |
| **Works with** | OpenCode, Claude Code, Cursor, Codex, or anything that can pipe JSON to a hook |

---

## Install

**Clone it, point one harness at it, keep the files.** There is no daemon, no SDK, no
build step and no dependency to audit — `node bin/session-ledger.js` is the whole
program, and every example below runs it where it sits.

```bash
git clone https://github.com/ay-garg/session-ledger.git
cd session-ledger
node bin/session-ledger.js show-config
```

`show-config` prints each resolved setting next to **where that value came from**, which
is the fastest answer to "why is it writing there?":

```text
config file: /Users/you/.config/session-ledger/config.json
  dir        /Users/you/.session-ledger  (default)
  timezone   Asia/Kolkata  (file:/Users/you/.config/session-ledger/config.json)
  scope      /Users/you/code  (file:/Users/you/.config/session-ledger/config.json)
  maxOutput  20000  (default)
  html       true  (default)
  prompts    true  (default)
  tools      true  (default)
```

Prefer the short name? `npm link` once in the clone and plain `session-ledger` works too.

### Prove it, without touching a harness

Two JSON events and one shell command — this is the entire input surface:

```bash
node bin/session-ledger.js hook --harness demo --tz Asia/Kolkata --dir /tmp/demo <<'JSON'
{"hook_event_name":"UserPromptSubmit","session_id":"demo","prompt":"Fix the checkout test"}
JSON

node bin/session-ledger.js hook --harness demo --tz Asia/Kolkata --dir /tmp/demo <<'JSON'
{"hook_event_name":"PostToolUse","session_id":"demo","tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello"}}
JSON

open /tmp/demo/*.html   # or: sed -n '1,40p' /tmp/demo/*.md
```

`2026-…-demo.md` and `2026-…-demo.html` land in `/tmp/demo`: one prompt and one command,
timestamped in `Asia/Kolkata`. The command shows `—` for its duration because no
before-event was sent — the after-event alone is still enough to record it. When that
works, the only thing left is how your harness calls the command.

---

## Harnesses

**One binary, five adapters.** The harness JSON differs; the ledger does not. Every file
below ships in [`adapters/`](adapters) — copy the one you need and replace its
placeholder path.

| Harness | Lives in | Verified |
| :--- | :--- | :--- |
| **OpenCode 2.x** | a plugin file under `~/.config/opencode/plugins/` | live session |
| **Claude Code** | `hooks` merged into `settings.json` | live, including headless |
| **Codex** | `~/.codex/hooks.json` | live, 0.165 |
| **Cursor** | `~/.cursor/hooks.json` | hook payloads |
| **Anything else** | your harness, piping JSON to `hook` | [by contract](#any-other-harness) |

### OpenCode 2.x

**`~/.config/opencode/plugins/session-ledger.ts`** — machine-local paths stay in the
wrapper, the adapter stays in the repo:

```ts
process.env.SESSION_LEDGER_DIR ??= "/path/to/your/logs"
process.env.SESSION_LEDGER_SCOPE ??= "/path/to/your/projects"

export { default } from "/absolute/path/to/session-ledger/adapters/opencode/entry.mjs"
```

Import `entry.mjs`, **not** `plugin.js`: OpenCode's resolver expects a neighbouring `.ts`
file when it is handed a `.js` import, and fails when the repo has none. Then reload —
`opencode api post /api/location/reload` — because a running session keeps its old
plugin snapshot until you do.

<details>
<summary>What the plugin hooks into</summary>

`session.hook("prompt")` for prompts; `execute.before` / `execute.after` for every tool.
It records the exact text, tool name, input, output, working directory, and a measured
duration.

</details>

### Claude Code

**`~/.claude/settings.json`**, or a project's `.claude/settings.json`. Merge the `hooks`
object from the [Claude Code example](adapters/claude-code/settings.example.json):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ]
  }
}
```

`"matcher": "*"` is what makes every tool fire the hook instead of `Bash` alone; the
non-shell ones become tool entries. Claude Code reports `duration_ms`, so durations are
the tool's own measurement rather than a wall-clock guess. Restart Claude Code, or open
`/hooks`, to confirm the wiring.

Running several profiles through `CLAUDE_CONFIG_DIR`? Each has its own `settings.json` —
add the hooks to every profile you want recorded.

### Codex

**`~/.codex/hooks.json`**, or `<repo>/.codex/hooks.json` for a single project:

```json
{
  "description": "Record every prompt, command and tool call Codex runs as a markdown ledger.",
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "timeout": 10,
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness codex" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "timeout": 10,
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness codex" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "timeout": 10,
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness codex" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "timeout": 10,
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness codex" }] }
    ]
  }
}
```

`Stop` is the reason file edits survive. Codex fires `PreToolUse` for `apply_patch` and
**never** `PostToolUse` for it, so at `Stop` anything that started and never reported
back is written — patch included — as an unconfirmed entry instead of being dropped.

> [!IMPORTANT]
> Codex runs only hooks it **trusts**. The first interactive launch shows a *Hooks need
> review* dialog: choose **Trust all and continue**. Headless runs (`codex exec`) skip
> untrusted hooks *silently*, so trust once in the TUI, or add
> `--dangerously-bypass-hook-trust` to automation that already vets the file. Editing
> `hooks.json` invalidates the trust, so re-trust after every change.

Profiles (`$CODEX_HOME/<name>.config.toml`) share that one file, so `~/.codex/hooks.json`
covers `codex --profile …` too.

### Cursor

**`~/.cursor/hooks.json`** for every project, or `<repo>/.cursor/hooks.json` for one:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor" }
    ],
    "preToolUse": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor" }
    ],
    "postToolUse": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor" }
    ],
    "postToolUseFailure": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor" }
    ]
  }
}
```

No `matcher` means every tool is recorded, MCP tools included.

> [!WARNING]
> Cursor **blocks the tool call** when a permission hook prints anything that is not
> valid JSON. session-ledger recognises Cursor's `preToolUse` payload and answers
> `{"permission":"allow"}` before writing anything, so the call proceeds — which also
> means that command's output must not be piped anywhere else.

### Any other harness

**If it can run a shell command and write JSON to stdin, it already works.** Three
moments are enough: prompt submitted, before a tool, after a tool.

| Field | Needed | Notes |
| :--- | :--- | :--- |
| `hook_event_name` (or `hookEventName`) | always | `UserPromptSubmit` / `beforeSubmitPrompt` for prompts; `PreToolUse` / `PostToolUse` / `PostToolUseFailure` for tools; optional `Stop` / `SessionEnd` to flush calls that never reported back |
| `session_id` | always | Also accepted: `conversation_id`, `thread_id`, `sessionId` |
| `prompt` | prompt | Also accepted: `user_prompt`, `userPrompt`, `message`, `text`, `input` |
| `tool_name` | tool | `bash` / `shell` / `exec_command` / `exec` / `powershell` / `terminal` / `sh` / `zsh` are shell commands; anything else is a tool call |
| `tool_input.command` | shell | Also accepted: `tool_input.cmd`, top-level `command` |
| `tool_input` | tool | Recorded as the tool's JSON input |
| `cwd` | optional | Falls back to `tool_input.working_directory`, `workspace_roots[0]`, the process cwd |
| `tool_response` / `tool_output` / `output` | optional | Unwrapped to readable text; JSON strings and `{stdout,stderr}` shapes are understood |
| `duration_ms` / `duration` / `durationMs` | optional | Milliseconds; without it the start event's timestamp measures the call |

An "after tool" event with no "before" still records the call — only the duration shows
`—`. A harness with no prompt event records commands and tools, but no prompt entries.

---

## What gets written

**One markdown file per session, named for the day it started**, beside an `.html` view
of the same events. Both are written by the hook that saw the event; nothing is
generated later.

`<YYYY-MM-DD>-<session-id>` — the date comes from the first recorded event in your
timezone, so a session that crosses midnight keeps its original file. The record is
plain markdown, which means it outlives the tool that wrote it:

````markdown
# 🗂 Session Ledger

| | |
| :--- | :--- |
| **Session** | `ses_9f2c71` |
| **Harness** | Claude Code |
| **Directory** | `/Users/ayush/code/checkout-api` |
| **Started** | 2026-10-30 23:17:04 IST |
| **Timezone** | `Asia/Kolkata` · UTC+05:30 |
| **Format** | session-ledger `0.6.0` · schema 1 |

### 💬 23:17:04 IST · `82424858`

```text
The checkout test is flaky on CI. Find the cause and fix it.
```

### ✅ 23:17:05 IST · 1.42 s · `call_01`

```bash
npm test -- --grep checkout
```

```text
12 passing (1.4 s)
```
````

`cat` it, `grep` it, `diff` it, commit it — or read it on GitHub with nothing installed.

**Five rules make it trustworthy.**

- **Order.** Entries append in the order they *finished*, so a nested subagent can land
  after the tools it spawned; its own timestamp still says when it started. The header
  is written once and never rewritten.
- **IDs.** Each entry carries the harness's message or tool-call ID, so it stays stable
  and unique within the session.
- **Clipping.** Prompt text, tool input and output stop at `maxOutput`, and the entry
  says exactly how many characters were dropped. Nothing vanishes quietly.
- **Fences.** A prompt containing a code fence gets a longer fence, so it cannot break
  the document.
- **Blanks and leftovers.** Empty output becomes `(no output)` instead of an invisible
  line, and a call the harness never finished is written at turn end instead of lost.

### Statuses

**The mark describes the tool call, not the shell command's exit code.** The first line
of an entry is the whole story:

| Entry line | Means |
| :--- | :--- |
| `💬 23:17:04 IST · 82424858` | a prompt; not a tool call, so it has no status |
| `✅ 23:17:05 IST · 1.42 s · call_01` | the harness reported the call finished |
| `❌ 23:17:05 IST · 2m 00s · call_02` | the harness reported a failure, interrupt, permission denial or error object |
| `⚠️ 23:17:07 IST · — · call_03` | announced, then the turn ended with no result: the input is kept, the output is not invented |

A command that exits `1` on purpose is still a completed call, with `Exit code 1` visible
in its output — nothing parses exit codes out of free-form text, because guessing would
be worse than not guessing. Codex has no failure hook at all, so a non-zero exit arrives
as an ordinary `PostToolUse` and stays completed, with the error in the output.

### The HTML page

**A view, not a second record.** One file, no JavaScript, no network requests, no remote
fonts, and one look: dark, like the terminal the work happened in. It is rewritten under
a short per-page lock, so parallel tool calls cannot corrupt it.

```bash
session-ledger render --dir ~/session-logs   # restyle every page in place
```

`render` swaps the stylesheet, the theme attributes and the one-line description, leaves
entries untouched, and takes the same lock the hooks take — safe while a session is
live. An entry is never re-parsed or reordered.

### Timezones

**Timestamps use an explicit IANA zone through `Intl.DateTimeFormat`, never the process's
`TZ`.** A hook launched from a container set to `TZ=UTC` cannot shift the record, and
each header keeps the zone name *and* its offset at that instant, so DST changes and
abbreviations like `IST` stay unambiguous.

---

## Configuration

**Flag beats environment, environment beats file, file beats the default** — and
`show-config` tells you which one won. Every key is settable all four ways:

| Key | Set with | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `dir` | `--dir` · `SESSION_LEDGER_DIR` | `~/.session-ledger` | Where `.md` and `.html` go |
| `timezone` | `--tz` · `SESSION_LEDGER_TZ` | machine zone | IANA zone for timestamps and the filename date |
| `scope` | `--scope` · `SESSION_LEDGER_SCOPE` | every session | Record only under this path |
| `maxOutput` | `--max-output` · `SESSION_LEDGER_MAX_OUTPUT` | `20000` | Characters kept per field |
| `prompts` | `--no-prompts` · `SESSION_LEDGER_PROMPTS` | `true` | Record user prompts |
| `tools` | `--no-tools` · `SESSION_LEDGER_TOOLS` | `true` | Record non-shell tools; shell commands always |
| `html` | `--no-html` · `SESSION_LEDGER_HTML` | `true` | `false` skips the page |

The file lives at `~/.config/session-ledger/config.json` and only needs the keys you want
to change:

```json
{ "dir": "~/session-logs", "timezone": "Asia/Kolkata", "scope": "~/code",
  "maxOutput": 20000, "prompts": true, "tools": true, "html": true }
```

Six details that save an afternoon:

- `~` is expanded, and relative paths resolve against the hook's working directory —
  which is the agent's session directory.
- An unknown `timezone` warns and falls back to the machine zone instead of writing
  broken timestamps.
- `scope` matches the **session directory** the harness reports, not a directory a
  command later `cd`s into. Point it at the parent of your projects.
- `--harness` is a label in the header; it does not change parsing.
- `--no-tools` never hides shell commands, and `--no-prompts` never touches commands or
  tools. Prompts can be off alone, if what you type is more sensitive than what runs.
- Environment variables suit a one-off run; the config file suits hooks, which inherit
  neither your aliases nor your exports.

---

## CLI

```
session-ledger hook         read one hook event on stdin and append it
session-ledger render       restyle every .html page in the output directory
session-ledger show-config  print resolved configuration and its sources
session-ledger help         usage
session-ledger --version    version
```

**A logging hook must never break the agent it observes.** `hook` therefore exits `0`
for normal operation *and* for malformed or unknown events, writing the complaint to
stderr. Only a genuine write failure — permissions, disk full — exits `1`, and it names
the path that failed.

`hook` and `show-config` accept `--dir`, `--tz`, `--scope`, `--max-output`,
`--no-prompts`, `--no-tools`, `--no-html` and `--config`; `hook` also takes
`--harness <label>`, and `render` reads `--dir` and `--config`.

---

## How it works

**One process per event, no server.** The harness runs the command; the command reads one
JSON object and exits.

```
harness ──JSON──▶ session-ledger hook ┬──▶ <date>-<session>.md     append-only
                                      └──▶ <date>-<session>.html   rewritten, locked
```

`core/normalize.js` is the only file that knows a harness's payload shape. Everything
after it — entry IDs, clipping, fences, status, timezone formatting, file naming,
locking — is shared, which is why a new harness is one function rather than a fork.

---

## Privacy

> [!CAUTION]
> Prompts, tool inputs and outputs are recorded **verbatim**, with no redaction. A
> `curl -H "Authorization: Bearer …"` and a pasted API key both land on disk in full.

- Keep the output directory out of version control.
- Use `scope` to record only the projects you intend to audit; `--no-prompts` and
  `--no-tools` narrow what is captured.
- Treat the log directory as at least as sensitive as your shell history — it also holds
  what you asked and what the agent read.

The page makes no network requests and loads no remote fonts, so opening a ledger leaks
it nowhere.

---

## Limits

**What each harness cannot tell us.** Missing data is stated, never guessed:

| Harness | Known gaps |
| :--- | :--- |
| **OpenCode 2.x** | Duration includes manual-approval wait; the timestamp is the request time, not process spawn |
| **Claude Code** | Hooks must be trusted and enabled; only the events you configure are recorded |
| **Cursor** | Requires a valid JSON reply on permission hooks |
| **Codex** | No failure event and no `duration_ms`; `apply_patch` has no result hook, so it lands unconfirmed at turn end |
| **Anything else** | Only what the harness emits; no prompt event means no prompt entries |

<details>
<summary>Other deliberate limits</summary>

- A command run through a wrapper (RTK, `nice`, a shell function) is recorded the way the
  wrapper saw it, not the way the deeper process ran it.
- Tool input is whatever the harness reports; a tool that mutates its arguments after the
  hook fires will differ from what the ledger shows.
- Subagent turns appear only if the harness routes their tool calls through the same hook
  events.
- The HTML page loses an entry if a process is killed while holding its lock; the
  markdown is never locked and never loses one.
- An `.html` keeps the stylesheet it was created with until you run
  `session-ledger render`, and its header card keeps its original wording.
- There is no rotation or retention policy. One file per session, forever.

</details>

---

## Troubleshooting

**Start with `session-ledger show-config`** — half of these are a directory or a clock,
and it prints both.

| Symptom | Usually because | Do this |
| :--- | :--- | :--- |
| No file at all | The session directory sits outside `scope` | Compare the harness's directory with `show-config`; widen or drop `scope` |
| No file in Cursor | The permission hook's stdout was piped or swallowed | Run the command as-is; Cursor needs its `{"permission":"allow"}` reply |
| No file in Codex | Hooks were never trusted | Open `/hooks`, review, trust; Codex skips silently until then |
| No file in OpenCode | The plugin was not reloaded, or failed to load | `opencode api post /api/location/reload`; import `entry.mjs`, not `plugin.js` |
| Tools missing | The hook matcher is narrower than `*` | Use `"matcher": "*"` (Claude Code, Codex) or omit it (Cursor) |
| Prompts only | Only prompt hooks were wired | Add the before and after tool events too |
| Every call twice | Hooks configured globally **and** in a project's `.claude/settings.json` | Keep one of the two |
| Wrong clock | `timezone` left at the machine default | Pin it: `--tz Asia/Kolkata`, or the config file |
| Duration is `—` | The harness sent no start event, so there is nothing to measure from | Expected for after-only harnesses |
| Page looks older | The stylesheet is written when the page is created | `session-ledger render --dir <dir>` |

---

## Development

```bash
node --test tests/          # 43 tests: unit + end-to-end, no dependencies
```

```
bin/session-ledger.js   the CLI: hook, render, show-config, flags, pending state
core/ledger.js          timezone formatting, durations, fences, output unwrapping
core/normalize.js       the only file that knows any harness's payload shape
core/config.js          flag > env > file > default, scope matching
core/store.js           file naming, append, HTML lock
core/markdown.js        the record
core/html.js            the page: stylesheet and markup
adapters/opencode/      native plugin + entry.mjs for OpenCode's resolver
adapters/claude-code/   settings snippet
adapters/cursor/        hooks.json
adapters/codex/         hooks.json
tests/                  node --test
docs/                   README screenshot
```

**Adding a harness** means teaching `core/normalize.js` one more payload shape — or, if
the harness has no hooks, writing an adapter that builds `Session` and `Entry` objects
and calls `record()`. Formatting and file writing are shared; do not duplicate them.

---

## License

MIT — see [LICENSE](LICENSE).
