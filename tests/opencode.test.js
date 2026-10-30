import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import plugin from "../adapters/opencode/plugin.js"

// The OpenCode adapter cannot be driven through the CLI, so exercise its hooks
// with the event shapes the V2 plugin API documents.

test("opencode: prompts, shell commands and tool calls all land in one file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "session-ledger-oc-"))
  process.env.SESSION_LEDGER_DIR = dir
  process.env.SESSION_LEDGER_TZ = "Asia/Kolkata"
  process.env.SESSION_LEDGER_HTML = "false"
  delete process.env.SESSION_LEDGER_SCOPE

  const hooks = {}
  const ctx = {
    app: { version: "2.2.3" },
    location: { directory: "/work/project" },
    options: {},
    session: {
      hook: (name, fn) => (hooks[name] = fn),
      get: async () => ({ title: "demo session" }),
    },
    tool: { hook: (name, fn) => (hooks[name] = fn) },
  }

  await plugin.setup(ctx)

  const prompt = { sessionID: "ses_op", messageID: "msg_0001", prompt: { text: "Run the tests" }, delivery: "steer" }
  await hooks.prompt(prompt)

  const call = { sessionID: "ses_op", messageID: "msg_0002", id: "call_1", agent: "build" }
  await hooks["execute.before"]({ ...call, tool: "bash", input: { command: "npm test", cwd: "/work/project" } })
  await hooks["execute.after"]({
    ...call,
    tool: "bash",
    input: { command: "npm test", cwd: "/work/project" },
    status: "completed",
    result: { content: "12 passing" },
  })

  const read = { sessionID: "ses_op", messageID: "msg_0003", id: "call_2", agent: "build" }
  await hooks["execute.before"]({ ...read, tool: "read", input: { file_path: "/work/project/a.js" } })
  await hooks["execute.after"]({
    ...read,
    tool: "read",
    input: { file_path: "/work/project/a.js" },
    status: "completed",
    result: { content: [{ type: "text", text: "export const a = 1" }] },
  })

  const files = (await readdir(dir)).filter((name) => name.endsWith(".md"))
  assert.equal(files.length, 1)

  const text = await readFile(join(dir, files[0]), "utf8")
  assert.match(text, /^### 💬 .*`msg_0001`$/m)
  assert.match(text, /```text\nRun the tests\n```/)
  assert.match(text, /```bash\nnpm test\n```/)
  assert.match(text, /12 passing/)
  assert.match(text, /🛠 `read`/)
  assert.match(text, /"file_path": "\/work\/project\/a.js"/)
  assert.match(text, /> \*\*demo session\*\*/)
})
