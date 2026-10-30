import { clip, pretty, textOf } from "./ledger.js"

// Every harness tells the same story in different words. This module is the only
// place that knows how. Input: a hook payload. Output: start / end / prompt / ignore.

const SHELL_TOOL = /^(bash|shell|exec_command|exec|powershell|terminal|sh|zsh)$/i

const START = /^(pre_?tool_?use|before_?shell_?execution|before_?mcp_?execution)$/i
const END = /^(post_?tool_?use|post_?tool_?use_?failure|after_?shell_?execution|after_?mcp_?execution)$/i
const PROMPT = /^(user_?prompt_?submit|before_?submit_?prompt)$/i
// End of a turn: whatever started and never finished is as final as it gets.
const TURN_END = /^(stop|session_?end)$/i

/**
 * @param {Record<string, any>} payload
 * @param {{ now?: Date, maxOutput?: number, timezone?: string, harness?: string }} [options]
 * @returns {{ kind: "ignore" }
 *   | { kind: "prompt", session: object, entry: object }
 *   | { kind: "start", session: object, key: string, started: Date, pending: object }
 *   | { kind: "end", session: object, key: string, entry: object }
 *   | { kind: "flush", session: object, reply: object | null }}
 */
export function normalize(payload, options = {}) {
  const now = options.now ?? new Date()
  const maxOutput = options.maxOutput ?? 20_000
  const raw = payload && typeof payload === "object" ? payload : {}

  const event = String(raw.hook_event_name ?? raw.hookEventName ?? "")
  const sessionID = firstString(raw.session_id, raw.conversation_id, raw.thread_id, raw.sessionId)
  if (!sessionID) return { kind: "ignore" }

  const toolName = String(raw.tool_name ?? raw.toolName ?? "")
  const input = raw.tool_input ?? raw.toolInput ?? {}
  const command = firstString(input.command, input.cmd, raw.command)
  const base = firstString(raw.cwd, input.working_directory, raw.workspace_roots?.[0], process.cwd())

  const session = {
    id: sessionID,
    harness: harnessOf(raw, options.harness),
    version: firstString(raw.cursor_version, raw.version, raw.cli_version),
    directory: base,
    started: now,
    timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    transcript: firstString(raw.transcript_path),
  }

  if (PROMPT.test(event)) {
    const prompt = promptText(raw)
    if (prompt.trim() === "") return { kind: "ignore" }
    const { body, truncated } = clip(prompt.trimEnd(), maxOutput)
    return {
      kind: "prompt",
      session,
      entry: {
        kind: "prompt",
        id: entryID(firstString(raw.message_id, raw.prompt_id), now),
        at: now,
        durationMs: null,
        status: "completed",
        prompt: body,
        cwd: base,
        output: "",
        truncated,
      },
    }
  }

  if (TURN_END.test(event)) {
    const last = firstString(raw.last_assistant_message)
    return { kind: "flush", session, reply: last.trim() === "" ? null : replyEntry(last, "", now, base, maxOutput) }
  }

  if (!START.test(event) && !END.test(event)) return { kind: "ignore" }

  // A shell call: either the tool name says so, or a shell hook sent a bare
  // `command` with no tool name. Anything else is a tool/MCP call.
  const shell = command !== "" && (!toolName || SHELL_TOOL.test(toolName))
  if (!shell && toolName === "") return { kind: "ignore" }

  const toolID = firstString(raw.tool_use_id, raw.tool_call_id, raw.id, raw.generation_id)
  const key = `${sessionID}:${toolID || `${toolName}:${pretty(input)}`.slice(0, 80)}`
  const args = shell ? null : clip(pretty(input), maxOutput)

  if (START.test(event)) {
    // Kept so a call that never reports back can still be written at turn end.
    return {
      kind: "start",
      session,
      key,
      started: now,
      pending: {
        sessionId: sessionID,
        id: entryID(toolID, now),
        harness: session.harness,
        command: shell ? command : "",
        tool: shell ? undefined : toolName,
        input: args?.body,
        inputTruncated: args?.truncated,
        cwd: base,
      },
    }
  }

  const failed = Boolean(/failure/i.test(event) || raw.error || raw.error_message || raw.failure_type)
  const reported = firstNumber(raw.duration_ms, raw.duration, raw.durationMs)
  const output = textOf(raw.tool_output ?? raw.tool_response ?? raw.output ?? raw.error_message ?? raw.error)
  const clipped = clip(output.trimEnd(), maxOutput)

  return {
    kind: "end",
    session,
    key,
    entry: {
      kind: shell ? "command" : "tool",
      id: entryID(firstString(raw.tool_use_id, raw.tool_call_id, raw.id, raw.generation_id), now),
      at: now,
      durationMs: reported ?? null,
      status: failed ? "failed" : "completed",
      command: shell ? command : "",
      tool: shell ? undefined : toolName,
      input: args?.body,
      inputTruncated: args?.truncated,
      cwd: base,
      output: clipped.body,
      truncated: clipped.truncated,
    },
  }
}

/**
 * Which harness sent this? Only used for the header label, so the explicit
 * `--harness` from our own config snippets wins; payload sniffing is a fallback
 * because Claude Code and Codex send almost identical events.
 */
export function harnessOf(raw, explicit) {
  if (explicit) return explicit
  if (raw.conversation_id || raw.cursor_version) return "Cursor"
  return "agent"
}

/** Cursor blocks a tool call when a permission hook prints anything but valid JSON. */
export function needsPermissionReply(raw) {
  const event = String(raw?.hook_event_name ?? "")
  return Boolean(raw?.conversation_id) && /^(pre_?tool_?use|before_?shell_?execution|before_?mcp_?execution)$/i.test(event)
}

/** Prompt text, whatever the harness called it. */
function promptText(raw) {
  const direct = firstString(raw.prompt, raw.user_prompt, raw.userPrompt)
  if (direct) return direct
  const candidate = raw.message ?? raw.text ?? raw.input
  if (typeof candidate === "string") return candidate
  if (candidate && typeof candidate === "object") return textOf(candidate)
  return ""
}

/** Never keyed on prompt_id: Stop carries it too, and it would repeat the prompt's ID. */
function replyEntry(text, id, at, cwd, maxOutput) {
  const { body, truncated } = clip(text.trimEnd(), maxOutput)
  return { kind: "reply", id: entryID(id, at), at, durationMs: null, status: "completed", reply: body, cwd, output: "", truncated }
}

/**
 * Stop hands over only a turn's last message; everything said between tool calls is
 * in the Claude Code transcript. Input: whole new lines of it. Output: reply entries.
 */
export function transcriptReplies(lines, session, maxOutput = 20_000) {
  const replies = []
  for (const line of lines.split("\n")) {
    const row = parseLine(line)
    if (row?.type !== "assistant" || row.isSidechain || !Array.isArray(row.message?.content)) continue
    const at = new Date(row.timestamp ?? Date.now())
    for (const block of row.message.content) {
      if (block.type !== "text" || block.text.trim() === "") continue
      replies.push(replyEntry(block.text, firstString(row.uuid), at, session.directory, maxOutput))
    }
  }
  return replies
}

function parseLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function entryID(id, now) {
  return (id || `${now.getTime()}`).replace(/^tool[-_]/i, "").slice(-8)
}

const firstString = (...values) => {
  for (const value of values) if (typeof value === "string" && value !== "") return value
  return ""
}

const firstNumber = (...values) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}
