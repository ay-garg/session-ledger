import { appendFile, mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { parts } from "./ledger.js"
import { entry as markdownEntry, header } from "./markdown.js"
import { ENTRIES_MARK, STATS_END, STATS_START, card, skeleton, stats } from "./html.js"

// Writing the two files that make up a ledger. Markdown is appended; the HTML has
// to be rewritten around a marker, so it takes a short lock when several hook
// processes (parallel tool calls) land at once.

const targets = new Map()
const queues = new Map()

export async function pathsFor(session, config) {
  const known = targets.get(session.id)
  if (known) return known

  // Reuse the file this session already writes to, so a session that crosses
  // midnight (or a hook process that starts after midnight) cannot split in two.
  const suffix = `-${session.id}.md`
  const existing = (await readdir(config.dir).catch(() => [])).find(
    (name) => name.endsWith(suffix) && name.length > suffix.length,
  )
  if (existing) {
    const found = { md: join(config.dir, existing), html: join(config.dir, existing.replace(/\.md$/, ".html")) }
    targets.set(session.id, found)
    return found
  }

  const base = `${parts(session.started, session.timezone).date}-${session.id}`
  const made = { md: join(config.dir, `${base}.md`), html: join(config.dir, `${base}.html`) }
  targets.set(session.id, made)
  return made
}

export async function record(session, entry, config) {
  const task = async () => {
    await mkdir(config.dir, { recursive: true })
    const target = await pathsFor(session, config)

    if (!existsSync(target.md)) await appendFile(target.md, header(session), "utf8")
    await appendFile(target.md, markdownEntry(entry, session), "utf8")

    if (config.html) await withLock(target.html, () => appendHtml(target.html, session, entry))
    return target
  }

  const previous = queues.get(session.id) ?? Promise.resolve()
  const run = previous.then(task, task)
  queues.set(
    session.id,
    run.catch(() => {}),
  )
  return run
}

async function appendHtml(file, session, entry) {
  let html = existsSync(file) ? await readFile(file, "utf8") : skeleton(session)
  // A function replacement, not a string: tool output containing `$&` or `$'`
  // would otherwise be expanded by String.replace and duplicate the document.
  html = html.replace(ENTRIES_MARK, () => card(entry, session) + ENTRIES_MARK)
  html = html.replace(
    new RegExp(`${STATS_START}[\\s\\S]*?${STATS_END}`),
    `${STATS_START}${stats(html)}${STATS_END}`,
  )
  await writeFile(file, html, "utf8")
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// shortcut: a lock left behind by a killed process is ignored after ~1s and the
// write proceeds, so the HTML can lose one entry. Upgrade to a PID-checked lock
// if that ever bites. The markdown is the record and is never locked.
async function withLock(file, fn) {
  const lock = `${file}.lock`
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const handle = await open(lock, "wx")
      await handle.close()
      try {
        return await fn()
      } finally {
        await rm(lock, { force: true })
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      await sleep(25)
    }
  }
  return fn()
}
