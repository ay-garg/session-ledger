import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { DEFAULT_MAX_OUTPUT } from "./ledger.js"

// One place to answer "where does this go and in whose clock?" for every harness.
// Precedence: CLI flag > environment > config file > default.

const home = () => process.env.HOME || homedir()

export const machineZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

export function configPath() {
  if (process.env.SESSION_LEDGER_CONFIG) return resolve(process.env.SESSION_LEDGER_CONFIG)
  const base = process.env.XDG_CONFIG_HOME || join(home(), ".config")
  return join(base, "session-ledger", "config.json")
}

function readConfigFile() {
  const path = configPath()
  try {
    return { path, values: JSON.parse(readFileSync(path, "utf8")) }
  } catch (error) {
    if (error.code !== "ENOENT") {
      process.stderr.write(`[session-ledger] ignoring ${path}: ${error.message}\n`)
    }
    return { path, values: {} }
  }
}

export function validZone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

const flag = (value) => !(value === false || /^(0|false|no|off)$/i.test(String(value)))

const expand = (path) => (path === "~" ? home() : path.startsWith("~/") ? join(home(), path.slice(2)) : path)

export function resolveConfig(overrides = {}) {
  const { path, values } = readConfigFile()
  const sources = {}

  const pick = (key, ...candidates) => {
    const labels = ["flag", "env", `file:${path}`, "default"]
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i] !== undefined && candidates[i] !== null && candidates[i] !== "") {
        sources[key] = labels[i]
        return candidates[i]
      }
    }
    sources[key] = "default"
    return undefined
  }

  const requested = pick(
    "timezone",
    overrides.timezone,
    process.env.SESSION_LEDGER_TZ,
    values.timezone,
    machineZone(),
  )
  const timezone = validZone(requested) ? requested : machineZone()
  if (timezone !== requested) process.stderr.write(`[session-ledger] unknown timezone "${requested}", using ${timezone}\n`)

  const dir = resolve(
    expand(
      String(
        pick("dir", overrides.dir, process.env.SESSION_LEDGER_DIR, values.dir, join(home(), ".session-ledger")),
      ),
    ),
  )

  const rawScope = pick("scope", overrides.scope, process.env.SESSION_LEDGER_SCOPE, values.scope, "")
  // an empty scope means "every session"
  const scope = rawScope ? resolve(expand(String(rawScope))) : ""

  const maxOutput = Number(
    pick("maxOutput", overrides.maxOutput, process.env.SESSION_LEDGER_MAX_OUTPUT, values.maxOutput, DEFAULT_MAX_OUTPUT),
  )

  const html = flag(pick("html", overrides.html, process.env.SESSION_LEDGER_HTML, values.html, true))
  const prompts = flag(pick("prompts", overrides.prompts, process.env.SESSION_LEDGER_PROMPTS, values.prompts, true))
  const replies = flag(pick("replies", overrides.replies, process.env.SESSION_LEDGER_REPLIES, values.replies, true))
  const tools = flag(pick("tools", overrides.tools, process.env.SESSION_LEDGER_TOOLS, values.tools, true))

  return {
    dir,
    timezone,
    scope,
    maxOutput: Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : DEFAULT_MAX_OUTPUT,
    html,
    prompts,
    replies,
    tools,
    sources,
    configPath: path,
  }
}

/** True when the session's directory is inside `config.scope` (or no scope is set). */
export function inScope(config, directory) {
  if (!config.scope) return true
  const dir = resolve(expand(String(directory || "")))
  return dir === config.scope || dir.startsWith(config.scope.endsWith("/") ? config.scope : `${config.scope}/`)
}

export function describeConfig(config) {
  const rows = ["dir", "timezone", "scope", "maxOutput", "html", "prompts", "replies", "tools"].map((key) => ({
    key,
    value: config[key] === "" ? "(every session)" : String(config[key]),
    source: config.sources[key],
  }))
  return { config: config.configPath, rows }
}
