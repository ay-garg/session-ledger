import { clip, textOf } from "./ledger.js"

// Every harness tells the same story in different words. This module is the only
// place that knows how. Input: a hook payload. Output: start / end / ignore.

const SHELL_TOOL = /^(bash|shell|exec_command|exec|powershell|terminal)$/i

const START = /^(pre_?tool_?use|before_?shell_?execution|before_?mcp_?execution)$/i
const END = /^(post_?tool_?use|post_?tool_?use_?failure|after_?shell_?execution|after_?mcp_?execution)$/i

/**
 * @param {Record<string, any>} payload
 * @param {{ now?: Date, maxOutput?: number }} [options]
 * @returns {{ kind: "ignore" } | { kind: "start", session: object, key: string, command: string, cwd: string, started: Date } | { kind: "end", session: object, entry: object }}
 */
export function normalize(payload, options = {}) {
  const now = options.now ?? new Date()
  const maxOutput = options.maxOutput ?? 20_000
  const raw = payload && typeof payload === "object" ? payload : {}

  const event = String(raw.hook_event_name ?? raw.hookEventName ?? "")
  if (!START.test(event) && !END.test(event)) return { kind: "ignore" }

  const toolName = String(raw.tool_name ?? raw.toolName ?? "")
  const input = raw.tool_input ?? raw.toolInput ?? {}
  const command = firstString(input.command, input.cmd, raw.command)
  const sessionID = firstString(raw.session_id, raw.conversation_id, raw.thread_id, raw.sessionId)

  // beforeShellExecution carries no tool name, so absence means "assume shell"
  if (!command || (toolName && !SHELL_TOOL.test(toolName))) return { kind: "ignore" }
  if (!sessionID) return { kind: "ignore" }

  const session = {
    id: sessionID,
    harness: harnessOf(raw, options.harness),
    version: firstString(raw.cursor_version, raw.version, raw.cli_version),
    directory: firstString(raw.cwd, input.working_directory, raw.workspace_roots?.[0], process.cwd()),
    started: now,
    timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  }

  const cwd = firstString(raw.cwd, input.working_directory, raw.workspace_roots?.[0], session.directory)
  const toolUseID = firstString(raw.tool_use_id, raw.tool_call_id, raw.id, raw.generation_id)
  const key = `${sessionID}:${toolUseID || command.slice(0, 40)}`

  if (START.test(event)) {
    return { kind: "start", session, key, command, cwd, started: now }
  }

  const failed = Boolean(/failure/i.test(event) || raw.error || raw.error_message || raw.failure_type)

  const reported = firstNumber(raw.duration_ms, raw.duration, raw.durationMs)
  const output = textOf(
    raw.tool_output ?? raw.tool_response ?? raw.output ?? raw.error_message ?? raw.error,
  )
  const { body, truncated } = clip(output.trimEnd(), maxOutput)

  return {
    kind: "end",
    session,
    key,
    entry: {
      id: (toolUseID || `${now.getTime()}`).replace(/^tool[-_]/i, "").slice(-8),
      at: now,
      durationMs: reported ?? null,
      status: failed ? "failed" : "completed",
      command,
      cwd,
      output: body,
      truncated,
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
