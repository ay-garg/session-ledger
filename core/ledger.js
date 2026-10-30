// Shared vocabulary for a session ledger. No harness imports and no build step:
// plain ESM so `node`, `bun` and any hook runner can load it as-is.

export const VERSION = "0.6.0"
export const SCHEMA = 1

export const DEFAULT_MAX_OUTPUT = 20_000

/**
 * @typedef {"completed" | "failed" | "unconfirmed"} Status
 * @typedef {"command" | "tool" | "prompt" | "reply"} Kind
 *
 * @typedef {object} Entry
 * @property {Kind} kind    Shell command, any other tool/MCP call, a user prompt, or the agent's reply.
 * @property {string} id        Stable, unique within the session. Never reused.
 * @property {Date} at          When the command was requested.
 * @property {number | null} durationMs  null when the harness does not report it.
 * @property {Status} status
 * @property {string} command   Shell command line (kind "command" only).
 * @property {string} [tool]    Harness tool name, including MCP tools (kind "tool").
 * @property {string} [prompt]  User prompt text (kind "prompt").
 * @property {string} [reply]   Text the agent wrote (kind "reply").
 * @property {string} cwd
 * @property {string} output
 * @property {string} [input]   Tool arguments, rendered (kind "tool").
 * @property {number} truncated  Characters dropped from `output`, 0 if intact.
 * @property {number} [inputTruncated] Characters dropped from `input`.
 *
 * @typedef {object} Session
 * @property {string} id
 * @property {string} [title]
 * @property {string} harness
 * @property {string} [version]
 * @property {string} directory
 * @property {Date} started
 * @property {string} timezone   IANA zone, pinned so a TZ=UTC process cannot skew the record.
 */

const stampers = new Map()

function stamper(timezone) {
  let f = stampers.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    stampers.set(timezone, f)
  }
  return f
}

/** Local date and clock for `at`, in `timezone`. */
export function parts(at, timezone) {
  /** @type {Record<string, string>} */
  const p = {}
  for (const part of stamper(timezone).formatToParts(at)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}

/** "IST", "GMT+1" — whatever the zone is called at that instant. */
export function zoneName(timezone, at) {
  const found = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value
  return found ?? timezone
}

/** "UTC+05:30" — unambiguous, unlike an abbreviation. */
export function zoneOffset(timezone, at) {
  const found = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value
  return (found ?? "").replace("GMT", "UTC") || "UTC+00:00"
}

export function duration(ms) {
  if (ms === null || ms === undefined) return "—"
  // Round before picking the unit, or 119.6 s reads as "1m 60s".
  if (Math.round(ms) < 1000) return `${Math.max(0, Math.round(ms))} ms`
  if (Math.round(ms / 10) < 6000) return `${(ms / 1000).toFixed(2)} s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

/** Fence longer than any backtick run inside `body`, so output can never break out. */
export function fence(body, lang) {
  let ticks = "```"
  while (body.includes(ticks)) ticks += "`"
  return `${ticks}${lang}\n${body.replace(/\n+$/, "")}\n${ticks}`
}

export function clip(text, limit = DEFAULT_MAX_OUTPUT) {
  if (text.length <= limit) return { body: text, truncated: 0 }
  return { body: text.slice(0, limit), truncated: text.length - limit }
}

/** Readable text for a tool's input object. */
export function pretty(value) {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Pull readable output out of whatever shape a harness reports. Every harness
 * wraps tool results differently and none of them promise stability, so this is
 * deliberately forgiving: wrong guess means ugly output, not lost output.
 */
export function textOf(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return maybeJson(value)
  if (typeof value !== "object") return String(value)
  if (Array.isArray(value)) return value.some(isText) ? joinParts(value) : dump(value)
  if (typeof value.stdout === "string" || typeof value.stderr === "string") {
    const { stdout = "", stderr = "", ...rest } = value
    return withRest([stdout, stderr].filter((s) => s.trim() !== "").join("\n"), rest)
  }
  // Claude Code's Read replies with the file body under file.content.
  if (value.file && typeof value.file.content === "string") return value.file.content
  // Claude Code's Edit and Write repeat the whole old file; the patch says what changed.
  if ("originalFile" in value) {
    const { originalFile, ...rest } = value
    return dump(rest)
  }
  for (const key of ["output", "content", "text", "message", "result"]) {
    const found = value[key]
    const { [key]: _, ...rest } = value
    if (typeof found === "string" && found !== "") return withRest(maybeJson(found), rest)
    if (Array.isArray(found) && found.some(isText)) return withRest(joinParts(found), rest)
  }
  return dump(value)
}

const isText = (part) =>
  typeof part === "string" || (typeof part?.text === "string" && Object.keys(part).every((key) => key === "type" || key === "text"))

const joinParts = (parts) =>
  parts.map((part) => (typeof part === "string" ? part : isText(part) ? part.text : dump(part))).filter(Boolean).join("\n")

// `exit_code: 0` or `interrupted: false` on every call would bury the output.
const saysSomething = ([key, value]) =>
  (typeof value === "object" && value !== null ? Object.keys(value).length > 0 : Boolean(value)) &&
  !(key === "type" && value === "text")

/** The readable part first, then whatever else the tool said, so nothing is lost. */
function withRest(text, rest) {
  const kept = Object.entries(rest).filter(saysSomething)
  return [text, kept.length > 0 ? dump(Object.fromEntries(kept)) : ""].filter(Boolean).join("\n\n")
}

const BINARY = /^[A-Za-z0-9+/=]+$/

const nameBinary = (_, item) =>
  typeof item === "string" && item.length > 1024 && BINARY.test(item)
    ? `[${item.length.toLocaleString("en-US")} characters of binary data not kept]`
    : item

function dump(value) {
  try {
    return JSON.stringify(value, nameBinary, 2)
  } catch {
    return String(value)
  }
}

function maybeJson(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text
  try {
    return textOf(JSON.parse(trimmed))
  } catch {
    return text
  }
}
