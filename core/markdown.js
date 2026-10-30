import { SCHEMA, VERSION, duration, fence, parts, zoneName, zoneOffset } from "./ledger.js"

// Markdown is the canonical record: plain text, append-only, readable with `cat`
// and on GitHub. Visual flourish lives in html.js — markdown cannot blur.

const cell = (text) => text.replace(/\|/g, "\\|")

export function header(session) {
  const starts = parts(session.started, session.timezone)
  const tz = zoneName(session.timezone, session.started)
  const harness = `${session.harness}${session.version ? ` \`${session.version}\`` : ""}`

  return [
    `<!-- session-ledger v${VERSION} · schema ${SCHEMA} · append-only -->`,
    "",
    "# 🗂 Session Ledger",
    ...(session.title ? ["", `> **${session.title}**`] : []),
    "",
    "| | |",
    "| :--- | :--- |",
    `| **Session** | \`${session.id}\` |`,
    `| **Harness** | ${harness} |`,
    `| **Directory** | \`${session.directory}\` |`,
    `| **Started** | ${starts.date} ${starts.time} ${tz} |`,
    `| **Timezone** | \`${session.timezone}\` · ${zoneOffset(session.timezone, session.started)} |`,
    `| **Format** | session-ledger \`${VERSION}\` · schema ${SCHEMA} |`,
    "",
    "> [!TIP]",
    "> Append-only record of every command this session ran, in order, with its output.",
    "> In each entry the `bash` block is the command and the `text` block below it is",
    "> what it printed. Entry IDs are stable and never reused.",
    "",
    "---",
    "",
    "",
  ].join("\n")
}

export function entry(e, session) {
  const at = parts(e.at, session.timezone)
  const tz = zoneName(session.timezone, e.at)
  const mark = e.status === "failed" ? "❌" : "✅"
  const where = e.cwd && e.cwd !== session.directory ? ` · \`${cell(e.cwd)}\`` : ""

  const printed = e.output.trim() === "" ? "(no output)" : e.output.replace(/\n+$/, "")
  const body =
    e.truncated > 0 ? `${printed}\n\n… ${e.truncated.toLocaleString("en-US")} characters truncated` : printed

  return [
    `### ${mark} ${at.time} ${tz} · ${duration(e.durationMs)} · \`${e.id}\`${where}`,
    "",
    fence(e.command, "bash"),
    "",
    fence(body, "text"),
    "",
    "",
  ].join("\n")
}
