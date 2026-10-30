import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { CSS } from "../core/html.js"

// End-to-end: feed the CLI the real payload shape each harness sends and check
// what lands on disk. If a harness changes its JSON, one of these fails loudly.

const CLI = fileURLToPath(new URL("../bin/session-ledger.js", import.meta.url))

function run(args, payload) {
  return new Promise((done) => {
    const child = execFile("node", [CLI, "hook", "--tz", "Asia/Kolkata", ...args], (error, stdout, stderr) => {
      done({ code: error?.code ?? 0, stdout, stderr })
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function cli(args) {
  return new Promise((done) => {
    execFile("node", [CLI, ...args], (error, stdout, stderr) => {
      done({ code: error?.code ?? 0, stdout, stderr })
    })
  })
}

async function sandbox() {
  return mkdtemp(join(tmpdir(), "session-ledger-"))
}

async function readMarkdown(dir) {
  const [file] = (await readdir(dir)).filter((name) => name.endsWith(".md"))
  assert.ok(file, `no markdown written to ${dir}`)
  return { file, text: await readFile(join(dir, file), "utf8") }
}

const claudeStart = {
  session_id: "cc-1",
  transcript_path: "/tmp/x.jsonl",
  cwd: "/work/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "npm test", description: "Run tests" },
  tool_use_id: "toolu_01ABC",
}

const claudeEnd = {
  ...claudeStart,
  hook_event_name: "PostToolUse",
  tool_response: { stdout: "12 passing", stderr: "", interrupted: false },
  duration_ms: 1420,
}

const cursorStart = {
  conversation_id: "cur-1",
  generation_id: "gen-1",
  hook_event_name: "preToolUse",
  workspace_roots: ["/work/project"],
  tool_name: "Bash",
  tool_input: { command: "ls -la" },
}

test("claude code: pre + post becomes one completed entry", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--harness", "Claude Code"], claudeStart)
  await run(["--dir", dir], claudeEnd)

  const { file, text } = await readMarkdown(dir)
  assert.match(file, /^\d{4}-\d{2}-\d{2}-cc-1\.md$/)
  assert.match(text, /Claude Code/)
  assert.match(text, /npm test/)
  assert.match(text, /12 passing/)
  assert.match(text, /^### ✅ \d{2}:\d{2}:\d{2} IST · 1\.42 s/m)
  assert.match(text, /Session.*`cc-1`/)
})

test("claude code: a failure event is marked failed, not completed", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], claudeStart)
  await run(["--dir", dir], {
    ...claudeEnd,
    hook_event_name: "PostToolUseFailure",
    error: "Exit code 1\nCannot find module 'express'",
    tool_response: undefined,
    duration_ms: 4187,
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ❌ /m)
  assert.match(text, /Cannot find module 'express'/)
  assert.match(text, /4\.19 s/)
})

test("codex: no duration field still yields a measured duration", async () => {
  const dir = await sandbox()
  const base = {
    session_id: "cx-1",
    cwd: "/work/project",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
  }
  await run(["--dir", dir, "--harness", "Codex"], base)
  await run(["--dir", dir, "--harness", "Codex"], {
    ...base,
    hook_event_name: "PostToolUse",
    tool_response: { output: "hi\n", exit_code: 0 },
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ✅ .* · (?!—)/m)
  assert.match(text, /echo hi/)
  assert.match(text, /Codex/)
})

test("cursor: permission hook answers so the tool is not blocked", async () => {
  const dir = await sandbox()
  const reply = await run(["--dir", dir], cursorStart)
  assert.equal(reply.stdout.trim(), '{"permission":"allow"}')
  assert.equal(reply.code, 0)
})

test("cursor: postToolUse unwraps the JSON string in tool_output", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], cursorStart)
  await run(["--dir", dir], {
    ...cursorStart,
    hook_event_name: "postToolUse",
    tool_output: JSON.stringify({ exitCode: 0, stdout: "total 0\ndrwxr-xr-x", stderr: "" }),
    duration: 63,
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ✅ .* · 63 ms/m)
  assert.match(text, /total 0/)
  assert.doesNotMatch(text, /exitCode/)
  assert.match(text, /Cursor/)
})

test("cursor: beforeShellExecution carries the command at top level", async () => {
  const dir = await sandbox()
  const base = {
    conversation_id: "cur-2",
    hook_event_name: "beforeShellExecution",
    command: "git status",
    cwd: "/work/project",
  }
  const reply = await run(["--dir", dir], base)
  assert.equal(reply.stdout.trim(), '{"permission":"allow"}')
  await run(["--dir", dir], {
    ...base,
    hook_event_name: "afterShellExecution",
    output: "On branch main",
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /git status/)
  assert.match(text, /On branch main/)
})

test("cursor: postToolUseFailure is marked failed", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], cursorStart)
  await run(["--dir", dir], {
    ...cursorStart,
    hook_event_name: "postToolUseFailure",
    error_message: "permission denied",
    duration: 12,
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ❌ /m)
  assert.match(text, /permission denied/)
})

test("a non-shell tool is recorded with its name, input and output", async () => {
  const dir = await sandbox()
  const base = {
    ...claudeEnd,
    tool_name: "Read",
    tool_input: { file_path: "/work/project/a.js" },
    tool_use_id: "toolu_read01",
  }
  await run(["--dir", dir], { ...base, hook_event_name: "PreToolUse", tool_response: undefined })
  await run(["--dir", dir], { ...base, tool_response: { type: "text", file: { content: "export const a = 1" } } })

  const { text } = await readMarkdown(dir)
  assert.match(text, /🛠 `Read`/)
  assert.match(text, /"file_path": "\/work\/project\/a\.js"/)
  assert.match(text, /export const a = 1/)
})

test("an MCP tool call is recorded like any other tool", async () => {
  const dir = await sandbox()
  const base = {
    ...claudeEnd,
    tool_name: "mcp__filesystem__read_file",
    tool_input: { path: "/work/project/a.js" },
    tool_use_id: "toolu_mcp01",
  }
  await run(["--dir", dir], { ...base, hook_event_name: "PreToolUse", tool_response: undefined })
  await run(["--dir", dir], { ...base, tool_response: { content: "file body" }, duration_ms: 9 })

  const { text } = await readMarkdown(dir)
  assert.match(text, /🛠 `mcp__filesystem__read_file`/)
  assert.match(text, /file body/)
})

test("claude code: a user prompt is recorded as a prompt entry", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], {
    session_id: "cc-prompt",
    cwd: "/work/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Fix the failing checkout test",
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### 💬 \d{2}:\d{2}:\d{2} IST · `\d+`$/m)
  assert.match(text, /Fix the failing checkout test/)
  assert.doesNotMatch(text, /✅|❌/)
})

test("cursor: beforeSubmitPrompt is recorded without a permission reply", async () => {
  const dir = await sandbox()
  const result = await run(["--dir", dir], {
    conversation_id: "cur-prompt",
    hook_event_name: "beforeSubmitPrompt",
    prompt: "Add a retry to the uploader",
  })
  assert.equal(result.stdout.trim(), "")

  const { text } = await readMarkdown(dir)
  assert.match(text, /Add a retry to the uploader/)
  assert.match(text, /Cursor/)
})

test("codex: UserPromptSubmit is recorded", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--harness", "Codex"], {
    session_id: "cx-prompt",
    cwd: "/work/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Why is the build slow?",
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /Why is the build slow\?/)
  assert.match(text, /Codex/)
})

test("prompts, commands and tools share one session file in order", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], { session_id: "mixed", cwd: "/work", hook_event_name: "UserPromptSubmit", prompt: "run tests" })
  await run(["--dir", dir], { ...claudeStart, session_id: "mixed", cwd: "/work" })
  await run(["--dir", dir], { ...claudeEnd, session_id: "mixed", cwd: "/work" })

  const { text } = await readMarkdown(dir)
  const promptAt = text.indexOf("### 💬")
  const commandAt = text.indexOf("### ✅")
  assert.ok(promptAt > 0 && commandAt > promptAt, "prompt must appear before the command it asked for")
})

test("--no-tools keeps shell commands but drops other tools", async () => {
  const dir = await sandbox()
  const base = { ...claudeEnd, tool_name: "Read", tool_input: { file_path: "/work/a.js" }, tool_use_id: "toolu_r2" }
  await run(["--dir", dir, "--no-tools"], { ...base, hook_event_name: "PreToolUse", tool_response: undefined })
  await run(["--dir", dir, "--no-tools"], base)

  assert.deepEqual(await readdir(dir).then((names) => names.filter((n) => n.endsWith(".md"))), [])
})

test("--no-prompts drops prompts but keeps commands", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--no-prompts"], {
    session_id: "cc-nop",
    cwd: "/work/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "not recorded",
  })
  assert.deepEqual(await readdir(dir).then((names) => names.filter((n) => n.endsWith(".md"))), [])

  await run(["--dir", dir, "--no-prompts"], claudeStart)
  await run(["--dir", dir, "--no-prompts"], claudeEnd)
  const { text } = await readMarkdown(dir)
  assert.match(text, /npm test/)
})

test("sessions outside the configured scope are skipped", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--scope", "/work/other"], claudeStart)
  await run(["--dir", dir, "--scope", "/work/other"], claudeEnd)

  assert.deepEqual(await readdir(dir), [])
})

test("one session writes one file even across many entries", async () => {
  const dir = await sandbox()
  for (let i = 0; i < 3; i++) {
    const start = { ...claudeStart, tool_input: { command: `echo ${i}` } }
    await run(["--dir", dir], start)
    await run(["--dir", dir], { ...claudeEnd, tool_input: { command: `echo ${i}` } })
  }

  const files = (await readdir(dir)).filter((name) => name.endsWith(".md"))
  assert.equal(files.length, 1)
  const text = await readFile(join(dir, files[0]), "utf8")
  assert.equal((text.match(/^# 🗂 Session Ledger$/gm) ?? []).length, 1)
  assert.equal((text.match(/^### ✅ /gm) ?? []).length, 3)
})

test("garbage on stdin is ignored instead of crashing the harness", async () => {
  const dir = await sandbox()
  const result = await new Promise((done) => {
    const child = execFile("node", [CLI, "hook", "--dir", dir], (error, stdout) => done({ code: error?.code ?? 0 }))
    child.stdin.end("not json")
  })

  assert.equal(result.code, 0)
  assert.deepEqual(await readdir(dir), [])
})

test("a call that never reports back is written at turn end, marked unconfirmed", async () => {
  const dir = await sandbox()
  // Codex announces apply_patch, never sends PostToolUse for it, then ends the turn.
  await run(["--dir", dir], {
    session_id: "cx-patch",
    cwd: "/work/project",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "apply_patch <<'PATCH'\n*** Begin Patch\n*** End Patch\nPATCH" },
    tool_use_id: "call_patch1",
  })
  // nothing on disk until the turn ends
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".md")), [])

  await run(["--dir", dir], { session_id: "cx-patch", cwd: "/work/project", hook_event_name: "Stop" })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ⚠️ \d{2}:\d{2}:\d{2} IST · — · `l_patch1`$/m)
  assert.match(text, /apply_patch/)
  assert.match(text, /no result reported by the harness/)
})

test("a turn end with nothing pending writes nothing and leaves no state", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], { session_id: "cx-quiet", cwd: "/work/project", hook_event_name: "Stop" })
  assert.deepEqual(await readdir(dir), [])
})

test("an unconfirmed call is not flushed into another session's file", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], { ...claudeStart, session_id: "ses-a", tool_use_id: "toolu_a" })
  await run(["--dir", dir], { session_id: "ses-b", cwd: "/work/project", hook_event_name: "Stop" })
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".md")), [])
})

test("render replaces an old page's stylesheet and leaves its entries alone", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], claudeStart)
  await run(["--dir", dir], claudeEnd)
  const [name] = (await readdir(dir)).filter((n) => n.endsWith(".html"))
  const page = join(dir, name)

  const stale = (await readFile(page, "utf8")).replace(/<style>[\s\S]*?<\/style>/, "<style>old{}</style>")
  await writeFile(page, stale, "utf8")

  const { code, stdout } = await cli(["render", "--dir", dir])
  assert.equal(code, 0)
  assert.match(stdout, /restyled 1 page/)

  const fresh = await readFile(page, "utf8")
  assert.ok(fresh.includes(CSS), "stylesheet is not the current one")
  assert.doesNotMatch(fresh, /old\{\}/)
  assert.match(fresh, /data-kind="command"/)
})
