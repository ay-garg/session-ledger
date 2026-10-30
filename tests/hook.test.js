import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

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

test("a non-shell tool is not recorded", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], {
    ...claudeEnd,
    tool_name: "Read",
    tool_input: { file_path: "/work/project/a.js" },
    tool_response: "contents",
  })

  assert.deepEqual(await readdir(dir), [])
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
