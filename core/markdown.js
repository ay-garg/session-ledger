import { SCHEMA, VERSION, duration, fence, parts, zoneName, zoneOffset } from "./ledger.js"

// Markdown is the canonical record: plain text, append-only, readable with `cat`
// and on GitHub. Visual flourish lives in html.js — markdown cannot blur.

const cell = (text) => String(text).replace(/\|/g, "\\|")
const note = (dropped) => `… ${dropped.toLocaleString("en-US")} characters truncated`

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
    "> Append-only record of every prompt, reply, command and tool call in this session, in order.",
    "> 💬 is a user prompt, 🤖 is text from the agent, a `bash` block is a shell command with its `text` output,",
    "> 🛠 is any other tool or MCP call with its input and output, and ⚠️ marks a call",
    "> whose result the harness never reported. Entry IDs are stable and never reused.",
    "",
    "---",
    "",
    "",
  ].join("\n")
}

export function entry(e, session) {
  if (e.kind === "prompt" || e.kind === "reply") return messageEntry(e, session)
  if (e.kind === "tool") return toolEntry(e, session)
  return commandEntry(e, session)
}

function commandEntry(e, session) {
  const head = headline(e, session)

  return [head, "", fence(e.command, "bash"), "", fence(outputOf(e), "text"), "", ""].join("\n")
}

function toolEntry(e, session) {
  const head = headline(e, session, ` · 🛠 \`${cell(e.tool ?? "tool")}\``)
  const input = e.input ?? ""
  const inputBody = e.inputTruncated > 0 ? `${input}\n\n${note(e.inputTruncated)}` : input

  return [
    head,
    "",
    "**Input**",
    "",
    fence(inputBody || "(no input)", "json"),
    "",
    "**Output**",
    "",
    fence(outputOf(e), "text"),
    "",
    "",
  ].join("\n")
}

function messageEntry(e, session) {
  const at = parts(e.at, session.timezone)
  const tz = zoneName(session.timezone, e.at)
  const where = e.cwd && e.cwd !== session.directory ? ` · \`${cell(e.cwd)}\`` : ""
  const mark = e.kind === "reply" ? "🤖" : "💬"
  const text = (e.kind === "reply" ? e.reply : e.prompt) ?? ""
  const body = e.truncated > 0 ? `${text.replace(/\n+$/, "")}\n\n${note(e.truncated)}` : text

  return [`### ${mark} ${at.time} ${tz} · \`${e.id}\`${where}`, "", fence(body, "text"), "", ""].join("\n")
}

function headline(e, session, extra = "") {
  const at = parts(e.at, session.timezone)
  const tz = zoneName(session.timezone, e.at)
  const mark = e.status === "failed" ? "❌" : e.status === "unconfirmed" ? "⚠️" : "✅"
  const where = e.cwd && e.cwd !== session.directory ? ` · \`${cell(e.cwd)}\`` : ""

  return `### ${mark} ${at.time} ${tz} · ${duration(e.durationMs)}${extra} · \`${e.id}\`${where}`
}

function outputOf(e) {
  if (e.status === "unconfirmed") return "(no result reported by the harness — the turn ended before this call finished)"
  const printed = e.output.trim() === "" ? "(no output)" : e.output.replace(/\n+$/, "")
  return e.truncated > 0 ? `${printed}\n\n${note(e.truncated)}` : printed
}
