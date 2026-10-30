# session-ledger

Every shell command your AI agent ran, with its output and timestamps, written to
one markdown file per session. Append-only, harness-agnostic, and readable a month
later without the tool that produced it.

```
2026-10-30-ses_e72ab7b8.md     ← the record: plain markdown, survives everything
2026-10-30-ses_e72ab7b8.html   ← the same session as a glassmorphism page
```

Works with **OpenCode**, **Claude Code**, **Cursor**, **Codex**, and any other
harness that can run a command and pipe JSON into it. No SDK, no server, no build
step — just `node` ≥ 18.

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
| **Format** | session-ledger `0.2.0` · schema 1 |

> [!TIP]
> Append-only record of every command this session ran, in order, with its output.
> In each entry the `bash` block is the command and the `text` block below it is
> what it printed. Entry IDs are stable and never reused.

---

### ✅ 21:09:11 IST · 5.59 s · `a8efe52e`

```bash
printf 'one\ntwo\n'
```

```text
one
two
```

### ❌ 21:10:04 IST · 418 ms · `c1f9a0b2`

```bash
npm test -- --grep checkout
```

```text
Exit code 1
Cannot find module 'express'
```
````

The markdown is the record: `cat` it, grep it, diff it, commit it, open it on
GitHub. The `> [!TIP]` callout renders on GitHub, VS Code and Obsidian and
degrades to a quote everywhere else.

### Why there is also an HTML file

Markdown cannot do translucency, blur or layered gradients — a "glassmorphism
markdown file" is not a thing. So the aesthetic lives in a self-contained HTML
page written next to the markdown: frosted cards, mesh gradient background, light
and dark by `prefers-color-scheme`, no JavaScript, no network requests. The
markdown stays canonical; the HTML is a view of it.

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
  "html": true
}
JSON

# 3. Check what was resolved, then wire your harness (next section)
node bin/session-ledger.js show-config
```

Requires **Node.js 18 or newer**. There are no dependencies to install and no
`npm run build`.

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
| `maxOutput` | `--max-output` | `SESSION_LEDGER_MAX_OUTPUT` | `20000` | Characters of output kept per command |
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

export { default } from "/absolute/path/to/session-ledger/adapters/opencode/plugin.js"
```

Reload with `opencode api post /api/location/reload`. A session already running
keeps its old plugin snapshot until it is reloaded. Verify by running a shell
command and checking that a `.md` appeared in your log directory.

The adapter uses OpenCode's native `execute.before` / `execute.after` tool hooks,
so it records the exact command, working directory and measured duration.

### Claude Code

Merge the `hooks` object from
[`adapters/claude-code/settings.example.json`](adapters/claude-code/settings.example.json)
into `~/.claude/settings.json` (or a project's `.claude/settings.json`), replacing
the placeholder path:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "Bash", "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness claude-code" }] }
    ]
  }
}
```

Restart Claude Code (or open `/hooks` to confirm the hooks loaded). `PreToolUse`
starts the clock; `PostToolUse` / `PostToolUseFailure` writes the entry. Claude
Code supplies `duration_ms`, so the duration in the ledger is the tool's own
measurement, not a wall-clock guess.

### Cursor

Copy [`adapters/cursor/hooks.json`](adapters/cursor/hooks.json) to
`~/.cursor/hooks.json` for every project, or to `<repo>/.cursor/hooks.json` for
one project, again replacing the path. It uses the generic tool hooks, filtered
to shell calls:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor",
        "matcher": "Shell" }
    ],
    "postToolUse": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor",
        "matcher": "Shell" }
    ],
    "postToolUseFailure": [
      { "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness cursor",
        "matcher": "Shell" }
    ]
  }
}
```

The full file ships in the adapter folder; this is the same content, formatted
for reading.

Cursor **blocks the tool call if a permission hook prints anything that is not
valid JSON**. session-ledger detects Cursor's `preToolUse` payload and answers
`{"permission":"allow"}` before writing anything, so the call proceeds. Do not
pipe the output of this command anywhere else.

Cursor runs user hooks from `~/.cursor/`, so absolute paths in `hooks.json` are
the safe choice. Its `tool_output` is a JSON *string*; the ledger unwraps it to
the readable `stdout` text, and reads `duration` in milliseconds.

### Codex

Copy [`adapters/codex/hooks.json`](adapters/codex/hooks.json) to
`~/.codex/hooks.json` (or `<repo>/.codex/hooks.json`):

```json
{
  "description": "Record every shell command Codex runs as a markdown ledger.",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "timeout": 10,
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness codex" }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "timeout": 10,
        "command": "node /absolute/path/to/session-ledger/bin/session-ledger.js hook --harness codex" }] }
    ]
  }
}
```

Codex requires non-managed hooks to be **reviewed and trusted** before they run:
open `/hooks` in the CLI, inspect the definition, and trust it. Until you do,
Codex skips the hook silently and prints a startup warning.

Project-local `.codex/hooks.json` only loads when the project's `.codex/` layer
is trusted.

### Any other harness

If the harness can run a shell command at "before tool" and "after tool" and
sends a JSON object on stdin, it already works. The contract is:

| Field | Required | Notes |
| :--- | :--- | :--- |
| `hook_event_name` | yes | Must look like `PreToolUse` / `PostToolUse` / `PostToolUseFailure`, or Cursor's `preToolUse` / `beforeShellExecution` / `afterShellExecution` |
| `session_id` | yes | Also accepted: `conversation_id`, `thread_id`, `sessionId` |
| `tool_input.command` | yes | Also accepted: `tool_input.cmd`, top-level `command` |
| `tool_name` | no | If present and not shell-like (`Bash`, `Shell`, `exec_command`, `terminal`, …) the event is ignored |
| `cwd` | no | Falls back to `tool_input.working_directory`, `workspace_roots[0]`, process cwd |
| `tool_response` / `tool_output` / `output` | no | Unwrapped to readable text; JSON strings and `{stdout,stderr}` shapes are understood |
| `duration_ms` / `duration` | no | Milliseconds. Without it, the start event's timestamp is used to measure |

A harness with only one "after" event and no "before" event still records the
command; only the duration shows `—`.

Minimal manual test, no harness involved:

```bash
echo '{"hook_event_name":"PostToolUse","session_id":"demo","tool_name":"Bash","tool_input":{"command":"echo hello"},"cwd":"'$PWD'","tool_response":{"stdout":"hello"}}' \
  | node bin/session-ledger.js hook --harness demo --dir /tmp/session-ledger-demo
cat /tmp/session-ledger-demo/*.md
```

---

## CLI reference

```
session-ledger hook        read one hook event on stdin and append it
session-ledger show-config print resolved configuration and its sources
session-ledger help        usage
session-ledger --version   version
```

`hook` exits `0` for normal operation and for malformed or unknown events, and
writes any complaint to stderr. A logging hook must never break the agent it is
observing, so a bad event is dropped rather than turned into a failed tool call.
A genuine write failure (permissions, disk full) exits `1` and says why; it is
never silent. `show-config` and unknown commands may also exit non-zero.

Flags accepted by `hook` and `show-config`: `--dir`, `--tz`, `--scope`,
`--max-output`, `--no-html`, `--config`. `hook` additionally accepts
`--harness <label>`.

---

## What gets written

- **One markdown file per session**, named `<YYYY-MM-DD>-<session-id>.md`, dated
  by the session's first recorded command **in your configured timezone**. A
  session that crosses midnight keeps writing to its original file.
- **A companion `.html`** with the same content, written alongside it. It is
  rewritten atomically under a short lock so parallel tool calls cannot corrupt
  it.
- **The markdown is append-only.** The header is written once; entries are only
  ever appended, in the order the harness reported them. That is what makes it an
  audit record rather than a log that can be silently rewritten.
- **Entry IDs** are derived from the harness's tool-call ID, so they are stable
  and unique within a session.
- **Output is fenced safely.** A command containing ```` ``` ```` gets a longer
  fence instead of breaking the document.
- **Long output is clipped** at `maxOutput` characters and the entry says exactly
  how many characters were dropped. It is never silently truncated.
- **Empty output** is written as `(no output)` rather than an invisible blank.

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

### Timezones

Every timestamp is formatted with an explicit IANA zone via `Intl.DateTimeFormat`
— never the process's `TZ`. A hook launched from a server or container running
`TZ=UTC` cannot shift the record. Each header records both the zone name
(`Asia/Kolkata`) and the offset at that instant (`UTC+05:30`), so daylight-saving
changes and abbreviations like `IST` are unambiguous.

Default is your machine's zone, resolved at run time; pin it in the config file
if the ledger must be consistent across machines.

---

## Privacy

The ledger records commands **and their output verbatim**. It will record secrets
that appeared in either: a `curl -H "Authorization: Bearer …"` lands on disk in
full, as does anything a command prints. There is no redaction.

- Keep the output directory out of version control (`OpenCode-Data/.gitignore`,
  or wherever you point `dir`).
- Use `scope` to limit recording to the projects you intend to audit.
- Treat the log directory as sensitive as the shell history it replaces.

The HTML page makes no network requests and loads no remote fonts, so opening it
does not leak the ledger anywhere.

---

## Limitations, honestly

| Harness | Verified | Known gaps |
| :--- | :--- | :--- |
| OpenCode 2.x | yes, live | Duration includes manual-approval wait; timestamp is request time, not process spawn |
| Claude Code | yes, hook payloads | Only `Bash` is matched by the shipped config; other tools are ignored by design |
| Cursor | yes, hook payloads | Requires a valid JSON reply on permission hooks — the CLI handles it, custom wrappers must too |
| Codex | yes, hook payloads | No failure event and no `duration_ms`; duration is measured between the two hooks |
| Anything else | contract above | Only shell commands are recorded; file edits are not |

Other deliberate limits:

- Commands run through a wrapper (RTK, `nice`, a shell function) are recorded as
  the wrapper saw them, not as the deeper process ran them.
- The HTML loses an entry if a process is killed while holding its lock; the
  markdown is never locked and never loses one.
- There is no rotation or retention policy. One file per session, forever.

---

## Development

```bash
node --test tests/          # unit + end-to-end tests
node bin/session-ledger.js show-config
```

```
bin/session-ledger.js   CLI: hook, show-config, flags, pending state
core/ledger.js          timezone formatting, durations, fences, output unwrapping
core/normalize.js       the only file that knows the three harness payload shapes
core/config.js          flag > env > file > default, scope matching
core/store.js           file naming, append, HTML lock
core/markdown.js        the record
core/html.js            the glass page
adapters/opencode/      native plugin
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
