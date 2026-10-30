# session-ledger

Every prompt you sent, every command and every tool or MCP call your AI agent
made — with inputs, outputs and timestamps — written to one markdown file per
session. Append-only, harness-agnostic, and readable a month later without the
tool that produced it.

```
2026-10-30-ses_e72ab7b8.md     ← the record: plain markdown, survives everything
2026-10-30-ses_e72ab7b8.html   ← the same session as a readable page
```

Works with **OpenCode**, **Claude Code**, **Cursor**, **Codex**, and any other
harness that can run a command and pipe JSON into it. No SDK, no server, no build
step — just `node` ≥ 18.

---

## Contents

| Getting started | Harnesses | Reference |
| :--- | :--- | :--- |
| [Install](#install) · [Verify it works](#verify-it-works) · [Configure](#configure) | [OpenCode](#opencode-2x) · [Claude Code](#claude-code) · [Cursor](#cursor) · [Codex](#codex) · [Any other](#any-other-harness) | [CLI](#cli-reference) · [What gets written](#what-gets-written) · [Troubleshooting](#troubleshooting) · [Privacy](#privacy) · [Limitations](#limitations-honestly) |

---

## What a session looks like

````markdown
# 🗂 Session Ledger

> **rtk and ponytail OpenCode setup**

| | |
| :--- | :--- |
| **Session** | `ses_e72ab7b8bffeg1CEvRlavjurSc` |
| **Harness** | OpenCode `2.2.3` |
| **Directory** | `/Users/ayush/claude-code` |
| **Started** | 2026-10-30 21:09:16 IST |
| **Timezone** | `Asia/Kolkata` · UTC+05:30 |
| **Format** | session-ledger `0.5.0` · schema 1 |

### 💬 21:09:14 IST · `msg_01H8`

```text
Fix the failing checkout test
```

### ✅ 21:09:16 IST · 5.59 s · `a8efe52e`

```bash
npm test -- --grep checkout
```

```text
12 passing
```

### ✅ 21:09:22 IST · 38 ms · 🛠 `mcp__github__search_issues`

**Input**

```json
{
  "query": "checkout timeout"
}
```

**Output**

```text
#142 Timeout in checkout when cart is empty
```
````

The markdown is the record: `cat` it, grep it, diff it, commit it, open it on
GitHub. The `> [!TIP]` callout (omitted above for length) renders on GitHub,
VS Code and Obsidian and degrades to a quote everywhere else.

- 💬 **prompts** show what you asked, verbatim, at the time you asked it.
- **commands** show the `bash` line that ran and its `text` output.
- 🛠 **tools and MCP calls** show the tool name, its JSON input, and its output.

### Why there is also an HTML file

Markdown cannot do colour, type hierarchy or a terminal block that scrolls. So
a self-contained HTML page is written next to it: a compact header, one card per
entry, timestamps and IDs in monospace, and commands and outputs in dark
terminal-style blocks — on a faint grid, light or dark by
`prefers-color-scheme`, with no JavaScript and no network requests. The markdown
stays canonical; the HTML is a view of it.

The page markup is deliberately plain, so `session-ledger render` can restyle
pages written by an older version without rereading the markdown.

---

## Install

Three steps. Nothing is global, nothing is compiled.

```bash
# 1. Get the code
git clone https://github.com/ay-garg/session-ledger.git
cd session-ledger

# 2. Choose where records go and in whose clock (optional — sensible defaults below)
mkdir -p ~/.config/session-ledger
cat > ~/.config/session-ledger/config.json <<'JSON'
{
  "dir": "~/session-logs",
  "timezone": "Asia/Kolkata",
  "scope": "~/code",
  "maxOutput": 20000,
  "prompts": true,
  "tools": true,
  "html": true
}
JSON

# 3. Check what was resolved, then wire your harness (next section)
node bin/session-ledger.js show-config
```

Requires **Node.js 18 or newer**. There are no dependencies to install and no
`npm run build`.

The commands below use `node bin/session-ledger.js` so nothing needs installing.
If you would rather type `session-ledger`, run `npm link` once in the clone;
every example then works with `session-ledger hook …` instead.

### Verify it works

Four lines, no harness involved — this is the fastest way to prove the install,
the timezone and the file naming before you touch any agent config:

```bash
printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"demo","cwd":"/tmp","prompt":"Fix the checkout test"}' \
  | node bin/session-ledger.js hook --harness demo --tz Asia/Kolkata --dir /tmp/session-ledger-demo
printf '%s' '{"hook_event_name":"PostToolUse","session_id":"demo","tool_name":"Bash","tool_input":{"command":"echo hello"},"cwd":"/tmp","tool_response":{"stdout":"hello"}}' \
  | node bin/session-ledger.js hook --harness demo --tz Asia/Kolkata --dir /tmp/session-ledger-demo
ls /tmp/session-ledger-demo
sed -n '1,40p' /tmp/session-ledger-demo/*.md
```

You should get `2026-…-demo.md` and `2026-…-demo.html`, one 💬 entry and one ✅
entry, timestamps in `Asia/Kolkata`. Open the `.html` with `open` to see the page
before you wire anything. If that works, the only remaining variable is the
harness wiring below.

### Where each value can come from

Later sources are only used when the earlier ones are absent:

| Priority | Source | Example |
| :--- | :--- | :--- |
| 1 | CLI flag | `--dir ~/logs --tz Europe/Berlin` |
| 2 | Environment variable | `SESSION_LEDGER_DIR=~/logs` |
| 3 | Config file | `~/.config/session-ledger/config.json` |
| 4 | Default | `~/.session-ledger`, machine timezone, every session |

`session-ledger show-config` prints every resolved value **and the source it came
from**, which is the fastest way to answer "why is it writing there?".

---

## Configure

| Key | Flag | Env var | Default | Meaning |
| :--- | :--- | :--- | :--- | :--- |
| `dir` | `--dir` | `SESSION_LEDGER_DIR` | `~/.session-ledger` | Directory for the `.md` / `.html` files |
| `timezone` | `--tz` | `SESSION_LEDGER_TZ` | machine zone | IANA zone for every timestamp and the filename date |
| `scope` | `--scope` | `SESSION_LEDGER_SCOPE` | every session | Only record sessions whose working directory is under this path |
| `maxOutput` | `--max-output` | `SESSION_LEDGER_MAX_OUTPUT` | `20000` | Characters kept per prompt, tool input and output |
| `prompts` | `--no-prompts` | `SESSION_LEDGER_PROMPTS` | `true` | Record user prompts |
| `tools` | `--no-tools` | `SESSION_LEDGER_TOOLS` | `true` | Record non-shell tool and MCP calls; shell commands are always recorded |
| `html` | `--no-html` | `SESSION_LEDGER_HTML` | `true` | Set `false` / `0` / `no` to skip the HTML page |

Notes that save debugging time:

- `~` is expanded; relative paths are resolved against the process's working
  directory, which for a hook is the agent's session directory.
- `timezone` must be an IANA name (`Asia/Kolkata`, `Europe/Berlin`,
  `America/New_York`). An unknown value prints a warning and falls back to the
  machine zone rather than writing broken timestamps.
- `scope` matches the **session directory** recorded by the harness, not the
  directory a command later `cd`s into. Set it to the parent of your projects,
  e.g. `~/code`, not to a single repo, if you work across repos.
- `--harness` is a label for the markdown header only (`claude-code`, `cursor`,
  `codex`, anything you like). It does not change parsing.
- `--no-tools` hides other tools but never shell commands, and `--no-prompts`
  never touches commands or tools. Prompts can be turned off alone if the text
  you type is more sensitive than the commands the agent runs.

Environment variables are handy for a one-off run; the config file is better for
hooks, because hook processes do not inherit your shell aliases or exports.

---

## Wire your harness

### OpenCode 2.x

OpenCode loads plugins from `~/.config/opencode/plugins/`. Keep machine-local
paths in that wrapper and let the adapter stay in the repo:

```ts
// ~/.config/opencode/plugins/session-ledger.ts
process.env.SESSION_LEDGER_DIR ??= "/path/to/your/logs"
process.env.SESSION_LEDGER_SCOPE ??= "/path/to/your/projects"

export { default } from "/absolute/path/to/session-ledger/adapters/opencode/entry.mjs"
```

Import `entry.mjs`, not `plugin.js`: OpenCode's plugin resolver looks for a
matching `.ts` file when it is given a `.js` import, and fails when the repo has
none.

Reload with `opencode api post /api/location/reload`. A session already running
keeps its old plugin snapshot until it is reloaded, so do this before you judge
whether it works. Verify by running a shell command and checking that a `.md`
appeared in your log directory, then send one message and look for a 💬 entry.

The adapter uses OpenCode's native `session.hook("prompt")` for prompts and
`execute.before` / `execute.after` for every tool, so it records the exact text,
tool name, input, output, working directory and measured duration.

### Claude Code

Merge the `hooks` object from
[`adapters/claude-code/settings.example.json`](adapters/claude-code/settings.example.json)
into `~/.claude/settings.json` (or a project's `.claude/settings.json`), replacing
the placeholder path. The shape:

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
    "PostToolUse": [ … same matcher and command … ],
    "PostToolUseFailure": [ … same matcher and command … ]
  }
}
```

The full file ships in the adapter folder; `…` above is only for brevity.
`"matcher": "*"` makes every tool fire the hook, not just `Bash`; non-shell tools
become 🛠 entries. Restart Claude Code or open `/hooks` to confirm the hooks
loaded. Claude Code supplies `duration_ms`, so durations are the tool's own
measurement, not a wall-clock guess.

This path is verified live, including headless runs (`claude -p "…"`), where hooks
fire exactly as they do interactively. If you keep several Claude Code profiles
via `CLAUDE_CONFIG_DIR` (work, personal, vertex), each profile has its own
`settings.json` — add the hooks to every profile you want recorded, or to a
project's `.claude/settings.json` to cover one repo.

### Cursor

Copy [`adapters/cursor/hooks.json`](adapters/cursor/hooks.json) to
`~/.cursor/hooks.json` for every project, or to `<repo>/.cursor/hooks.json` for
one project, again replacing the path:

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
    "postToolUse": [ … same command … ],
    "postToolUseFailure": [ … same command … ]
  }
}
```

No `matcher` means every tool is recorded, including MCP tools. Cursor **blocks
the tool call if a permission hook prints anything that is not valid JSON**.
session-ledger detects Cursor's `preToolUse` payload and answers
`{"permission":"allow"}` before writing anything, so the call proceeds. Do not
pipe the output of this command anywhere else.

Cursor runs user hooks from `~/.cursor/`, so absolute paths in `hooks.json` are
the safe choice. Its `tool_output` is a JSON *string*; the ledger unwraps it to
the readable `stdout` text, and reads `duration` in milliseconds.

### Codex

Copy [`adapters/codex/hooks.json`](adapters/codex/hooks.json) to
`~/.codex/hooks.json` (or `<repo>/.codex/hooks.json`), replacing the path:

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
    "PostToolUse": [ … same matcher and command … ],
    "Stop": [ … same command, no matcher … ]
  }
}
```

`Stop` is not decoration: Codex fires `PreToolUse` for `apply_patch` but **never
`PostToolUse`** for it, so a file edit would otherwise vanish from the record.
At `Stop`, anything that started and never reported back is written with ⚠️ and
its patch or command line, instead of being dropped.

Verified live against Codex 0.165 with a custom provider profile
(`codex --profile … exec`), including prompt, `Bash`, `apply_patch`, failed
commands and turn end.

**Codex requires hooks to be trusted before they run.** The first interactive
launch shows a *Hooks need review* dialog — choose **Trust all and continue**.
Headless runs (`codex exec`) skip untrusted hooks **silently**, so either trust
once in the TUI first, or add `--dangerously-bypass-hook-trust` to automation
that already vets the file. Editing `hooks.json` invalidates the trust, so
re-trust after any change.

If you use profiles (`$CODEX_HOME/<name>.config.toml`), the hooks file is shared
across all of them: `~/.codex/hooks.json` applies to every profile, including
`codex --profile enmaas`.

Project-local `.codex/hooks.json` only loads when the project's `.codex/` layer
is trusted.

### Any other harness

If the harness can run a shell command at "prompt submitted", "before tool" and
"after tool" and sends a JSON object on stdin, it already works. The contract is:

| Field | Required | Notes |
| :--- | :--- | :--- |
| `hook_event_name` (or `hookEventName`) | yes | `UserPromptSubmit` / `beforeSubmitPrompt` for prompts; `PreToolUse` / `PostToolUse` / `PostToolUseFailure` for tools; optional `Stop` / `SessionEnd` to flush calls that never reported back |
| `session_id` | yes | Also accepted: `conversation_id`, `thread_id`, `sessionId` |
| `prompt` | prompts | Also accepted: `user_prompt`, `userPrompt`, `message`, `text` |
| `tool_name` | tools | Free-form; `Bash` / `Shell` / `exec_command` / `terminal` / `sh` / `zsh` are treated as shell commands, everything else as a tool call |
| `tool_input.command` | shell | Also accepted: `tool_input.cmd`, top-level `command` |
| `tool_input` | tools | Recorded as the tool's JSON input |
| `cwd` | no | Falls back to `tool_input.working_directory`, `workspace_roots[0]`, process cwd |
| `tool_response` / `tool_output` / `output` | no | Unwrapped to readable text; JSON strings and `{stdout,stderr}` shapes are understood |
| `duration_ms` / `duration` | no | Milliseconds. Without it, the start event's timestamp is used to measure |

A harness with only an "after tool" event and no "before" event still records the
call; only the duration shows `—`. A harness with no prompt event records
commands and tools but no 💬 entries.

The command your harness runs is the same one from
[Verify it works](#verify-it-works) — add `--harness <name>` to label the header,
and point the hook at every event in the table above.

---

## CLI reference

```
session-ledger hook        read one hook event on stdin and append it
session-ledger render      restyle every .html page in the output directory
session-ledger show-config print resolved configuration and its sources
session-ledger help        usage
session-ledger --version   version
```

`hook` exits `0` for normal operation and for malformed or unknown events, and
writes any complaint to stderr. A logging hook must never break the agent it is
observing, so a bad event is dropped rather than turned into a failed tool call.
A genuine write failure (permissions, disk full) exits `1` and says why; it is
never silent. `show-config` and unknown commands may also exit non-zero.

`render` brings existing pages up to the current look: for every `.html` in the
output directory it swaps the stylesheet and the one-line description, leaving
the entries alone. It takes the same per-page lock the hooks take, so it is safe
to run while a session is live. Pages are never rebuilt from the markdown, so an
entry is never re-parsed or reordered.

```
session-ledger render --dir ~/session-logs
```

Flags accepted by `hook` and `show-config`: `--dir`, `--tz`, `--scope`,
`--max-output`, `--no-prompts`, `--no-tools`, `--no-html`, `--config`. `hook`
additionally accepts `--harness <label>`; `render` reads `--dir` and `--config`.

---

## What gets written

- **One markdown file per session**, named `<YYYY-MM-DD>-<session-id>.md`, dated
  by the session's first recorded event **in your configured timezone**. A
  session that crosses midnight keeps writing to its original file.
- **A companion `.html`** with the same content, written alongside it. It is
  rewritten atomically under a short lock so parallel tool calls cannot corrupt
  it.
- **The markdown is append-only.** The header is written once; entries are only
  ever appended, in the order they *finished*. That is what makes it an audit
  record rather than a log that can be silently rewritten. A nested call (an
  `Agent`/subagent turn) therefore lands after the tools it spawned — its own
  timestamp still shows when it started.
- **Entry IDs** are derived from the harness's message/tool-call ID, so they are
  stable and unique within a session.
- **Turn end flushes the leftovers.** If a harness ends the turn with a call
  that never reported a result, it is written as ⚠️ unconfirmed rather than
  silently lost.
- **Paths are dated once per session** and reused, so a long session cannot split
  into two files at midnight.
- **Prompt text, tool input and output are all clipped** at `maxOutput`
  characters; the entry says exactly how many characters were dropped, and a
  clipped tool input gets its own note under **Input**. Nothing is silently
  truncated.
- **Empty output** is written as `(no output)` rather than an invisible blank.
- **Safe fences.** A prompt or command containing ```` ``` ```` gets a longer
  fence instead of breaking the document.

### Status semantics

`✅ completed` / `❌ failed` describe **the tool call**, not the command's exit
code:

- `❌ failed` means the harness reported a failure event, an interrupt, a
  permission denial, or an error object.
- A shell command that exits `1` normally is still `✅ completed`, with
  `Exit code 1` and the error text visible in its output. Nothing parses exit
  codes out of free-form output; guessing there would be worse than not guessing.
- **Codex has no failure hook**: a non-zero exit arrives as a normal
  `PostToolUse`, so it stays `✅ completed` and the failure is visible in the
  output text.
- `⚠️ unconfirmed` means the harness announced the call but never reported a
  result — Codex does this for `apply_patch`. The input is kept, the output is
  not invented, and the entry says so. Nothing about the exit code is guessed.
- Prompts are marked 💬 instead of a status, because they are not tool calls.

### Timezones

Every timestamp is formatted with an explicit IANA zone via `Intl.DateTimeFormat`
— never the process's `TZ`. A hook launched from a server or container running
`TZ=UTC` cannot shift the record. Each header records both the zone name
(`Asia/Kolkata`) and the offset at that instant (`UTC+05:30`), so daylight-saving
changes and abbreviations like `IST` are unambiguous.

Default is your machine's zone, resolved at run time; pin it in the config file
if the ledger must be consistent across machines.

### Reading a ledger

```bash
cat  OpenCode-Data/2026-10-30-*.md          # the record, top to bottom
grep '^### 💬' OpenCode-Data/*.md           # every prompt you sent, across sessions
grep -A3 '🛠 `mcp__' OpenCode-Data/*.md     # every MCP call and its input
open OpenCode-Data/2026-10-30-*.html        # the same session, as a page
```

A whole session diffs cleanly: the header is stable and entries only append, so
`git diff` shows exactly what happened between two points in time.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| No file at all | Session directory outside `scope` | Compare the harness's directory with `show-config`; widen or drop `scope` |
| No file at all (Cursor) | The permission hook's stdout was piped or swallowed | The command must be run as-is; Cursor needs its `{"permission":"allow"}` reply |
| No file at all (Codex) | Hooks never trusted | Open `/hooks`, review, trust; Codex skips silently until then |
| No file at all (OpenCode) | Plugin not reloaded, or it failed to load | `opencode api post /api/location/reload`; import `entry.mjs`, not `plugin.js` |
| Commands recorded, tools missing | Hook matcher is narrower than `*` | Use `"matcher": "*"` (Claude Code, Codex) or omit it (Cursor) |
| Prompts recorded, nothing else | Only prompt hooks were wired | Add the before/after tool events too |
| Every call appears twice | Hooks configured globally **and** in a project `.claude/settings.json` | Keep one of the two |
| Wrong clock | `timezone` left at the machine default | Pin it: `--tz Asia/Kolkata` or the config file |
| Duration shows `—` | The harness sent no start event, so there is nothing to measure from | Expected for after-only harnesses |
| Page looks like an older version | The stylesheet is written when the page is created | `session-ledger render --dir <dir>` rewrites it in place, entries untouched |

`hook` never fails an agent turn: malformed JSON, unknown events and out-of-scope
sessions exit `0` after writing a line to stderr. If you see exit `1`, it is a
real write problem — permissions or disk — and the message says which path.

---

## Privacy

The ledger records **prompts, tool inputs and outputs verbatim**. That includes
everything you typed into the agent, every file path and argument a tool
received, and everything a command printed. Secrets land on disk in full: a
`curl -H "Authorization: Bearer …"` and a pasted API key are both recorded.
There is no redaction.

- Keep the output directory out of version control (`OpenCode-Data/.gitignore`,
  or wherever you point `dir`).
- Use `scope` to limit recording to the projects you intend to audit, and
  `--no-prompts` / `--no-tools` to narrow what is captured.
- Treat the log directory as sensitive as the shell history it replaces —
  arguably more so, because it also holds what you asked and what the agent read.

The HTML page makes no network requests and loads no remote fonts, so opening it
does not leak the ledger anywhere.

---

## Limitations, honestly

| Harness | Verified | Known gaps |
| :--- | :--- | :--- |
| OpenCode 2.x | yes, live | Duration includes manual-approval wait; timestamp is request time, not process spawn |
| Claude Code | yes, live | Hooks must be trusted and enabled; only events you configure are recorded |
| Cursor | yes, hook payloads | Requires a valid JSON reply on permission hooks — the CLI handles it, custom wrappers must too |
| Codex | yes, live | No failure event and no `duration_ms`; `apply_patch` gets no result hook, so it is recorded as ⚠️ unconfirmed at turn end |
| Anything else | contract above | Only what the harness emits; no prompt event means no prompt entries |

Other deliberate limits:

- Commands run through a wrapper (RTK, `nice`, a shell function) are recorded as
  the wrapper saw them, not as the deeper process ran them.
- Tool input is what the harness reports. A tool that mutates arguments after the
  hook fires will differ from what the ledger shows.
- Subagent turns appear only if the harness routes their tool calls through the
  same hook events.
- The HTML loses an entry if a process is killed while holding its lock; the
  markdown is never locked and never loses one.
- An `.html` keeps the stylesheet it was created with until you run
  `session-ledger render`, which swaps it for the current one in place. The
  header card keeps its original wording.
- There is no rotation or retention policy. One file per session, forever.

---

## Development

```bash
node --test tests/          # 43 unit + end-to-end tests
node bin/session-ledger.js show-config
```

```
bin/session-ledger.js   CLI: hook, render, show-config, flags, pending state
core/ledger.js          timezone formatting, durations, fences, output unwrapping
core/normalize.js       the only file that knows every harness payload shape
core/config.js          flag > env > file > default, scope matching
core/store.js           file naming, append, HTML lock
core/markdown.js        the record
core/html.js            the page: stylesheet and markup
adapters/opencode/      native plugin + entry.mjs for OpenCode's resolver
adapters/claude-code/   settings snippet
adapters/cursor/        hooks.json
adapters/codex/         hooks.json
tests/                  node --test
```

Adding a harness means teaching `core/normalize.js` one more payload shape, or —
if the harness has no hooks — writing an adapter that builds `Session` and
`Entry` objects and calls `record()` from `core/store.js`. Formatting and file
writing are shared and should not be duplicated.

## License

MIT
