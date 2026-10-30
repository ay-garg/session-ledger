import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { parts } from "./ledger.js"
import { entry as markdownEntry, header } from "./markdown.js"
import { ENTRIES_MARK, card, extendTail, skeleton, upgrade } from "./html.js"

// Writing the two files that make up a ledger. Markdown is appended; a new HTML card
// replaces the short tail of the page, so it takes a short lock when several hook
// processes (parallel tool calls) land at once. Neither cost grows with the page.

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
  const html = card(entry, session)
  if (!existsSync(file)) await writeFile(file, skeleton(session), "utf8")
  if (await appendToTail(file, html)) return
  await rebuild(file, session)
  await appendToTail(file, html)
}

// Everything after the cards fits well inside this.
const TAIL_BYTES = 16 * 1024

// Reads and rewrites only the end of the page, so a card costs the same on a 100 MB
// page as on an empty one. False when the tail is not one this version can extend.
async function appendToTail(file, html) {
  const handle = await open(file, "r+")
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const position = size - length
    const { buffer } = await handle.read(Buffer.alloc(length), 0, length, position)
    const mark = buffer.lastIndexOf(ENTRIES_MARK)
    if (mark === -1) return false
    const next = extendTail(buffer.toString("utf8", mark), html)
    if (next === null) return false
    const bytes = Buffer.from(next, "utf8")
    const { bytesWritten } = await handle.write(bytes, 0, bytes.length, position + mark)
    if (bytesWritten !== bytes.length) throw new Error(`${file}: short write`)
    return true
  } finally {
    await handle.close()
  }
}

// The slow path, once per page at most: an older layout, or a write cut short by a
// killed process, which costs the card it was writing and nothing before it.
async function rebuild(file, session) {
  const html = await readFile(file, "utf8")
  const mark = html.lastIndexOf(ENTRIES_MARK)
  const last = html.lastIndexOf("</section>")
  if (mark === -1 && last === -1) throw new Error(`${file}: entries marker missing, page not updated (the markdown has this entry)`)
  if (mark === -1) process.stderr.write(`[session-ledger] ${file} was cut short, keeping the cards before the cut\n`)
  const cards = html.slice(0, mark === -1 ? last + "</section>\n".length : mark)
  const fresh = skeleton(session)
  await replaceFile(file, upgrade(cards + fresh.slice(fresh.indexOf(ENTRIES_MARK))))
}

// Rename swaps the whole file at once, so a killed process leaves the old page.
export async function replaceFile(file, text) {
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, text, "utf8")
  await rename(temp, file)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// No write takes this long, so an older lock is abandoned even if its PID was reused.
const LOCK_STALE = 10_000

const abandoned = async (lock) => {
  const held = await stat(lock).catch(() => null)
  if (!held) return false
  if (Date.now() - held.mtimeMs > LOCK_STALE) return true
  const pid = Number(await readFile(lock, "utf8").catch(() => ""))
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error.code === "ESRCH"
  }
}

// Waits for as long as the holder is alive; writing without the lock is how a page
// loses entries. The lock names its owner so a killed process costs no wait at all.
// shortcut: two waiters can clear the same dead lock and race, which loses at most
// one entry from the page. The markdown is the record and is never locked.
export async function withLock(file, fn) {
  const lock = `${file}.lock`
  for (;;) {
    try {
      const handle = await open(lock, "wx")
      await handle.writeFile(String(process.pid))
      await handle.close()
      try {
        return await fn()
      } finally {
        await rm(lock, { force: true })
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      if (await abandoned(lock)) await rm(lock, { force: true })
      await sleep(5)
    }
  }
}
