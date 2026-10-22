// WhatsApp gateway for the Centre Focus CRM.
//
// Links one WhatsApp account as a "linked device" (QR code, like WhatsApp Web)
// through whatsapp-web.js, then exposes a tiny internal HTTP API to Django:
//   GET  /healthz   liveness (no auth)
//   GET  /status    { state, qr, me }
//   POST /send      { phone, text } -> { id }
//   POST /check     { phone } -> { exists } (lookup only, nothing sent)
//   GET  /chats                     one-to-one chats, newest first (read live)
//   GET  /chats/:id/messages        latest messages of a chat
//   POST /chats/:id/send  { text }  reply inside a chat
//   POST /logout    unlink the device and show a new QR code
// Incoming one-to-one messages are forwarded to Django (CRM_INCOMING_URL).
//
// Unofficial: WhatsApp may restrict accounts used this way. Django enforces
// low daily limits and spacing between messages.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import QRCode from 'qrcode'
import wwebjs from 'whatsapp-web.js'

const { Client, LocalAuth } = wwebjs

const PORT = Number(process.env.PORT ?? 3000)
const TOKEN = process.env.GATEWAY_TOKEN ?? ''
const DATA_DIR = process.env.DATA_DIR ?? '/data'
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium'
const INCOMING_URL = process.env.CRM_INCOMING_URL ?? ''

if (!TOKEN) {
  console.error('GATEWAY_TOKEN is required')
  process.exit(1)
}

const log = (...args) => console.log(new Date().toISOString(), ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomBetween = (min, max) => min + Math.random() * (max - min)

// ---------------------------------------------------------------- WhatsApp

let client = null
let state = 'initializing' // initializing | qr | connected | disconnected
let qrDataUrl = null
let me = null
let restarting = false
let readyWatchdog = null
const READY_TIMEOUT_MS = 90_000

/** Chromium refuses to start if a previous container left its profile locks behind. */
function removeStaleLocks(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.name.startsWith('Singleton')) fs.rmSync(full, { force: true })
    else if (entry.isDirectory()) removeStaleLocks(full)
  }
}

function startClient() {
  removeStaleLocks(DATA_DIR)
  state = 'initializing'
  qrDataUrl = null
  me = null
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
    deviceName: 'Centre Focus CRM',
    browserName: 'Chrome',
    puppeteer: {
      headless: true,
      executablePath: CHROMIUM,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
    },
  })

  client.on('qr', async (qr) => {
    state = 'qr'
    qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 })
    log('QR code ready, waiting for scan')
  })
  client.on('authenticated', () => {
    log('Authenticated')
    // Errors inside WhatsApp Web (e.g. a renamed internal module) are otherwise invisible.
    const page = client.pupPage
    if (page && !page.__focusLogging) {
      page.__focusLogging = true
      page.on('pageerror', (error) => log('Page error:', String(error?.message ?? error).slice(0, 300)))
      page.on('console', (message) => {
        if (message.type() === 'error') log('Page console error:', message.text().slice(0, 300))
      })
    }
    // whatsapp-web.js occasionally authenticates but never becomes ready: start over.
    clearTimeout(readyWatchdog)
    readyWatchdog = setTimeout(() => {
      if (state !== 'connected') {
        log(`Not ready ${READY_TIMEOUT_MS / 1000} s after authentication, restarting`)
        restart(3_000)
      }
    }, READY_TIMEOUT_MS)
  })
  client.on('loading_screen', (percent) => log(`Loading WhatsApp Web: ${percent}%`))
  client.on('change_state', (next) => log('WhatsApp state:', next))
  client.on('ready', () => {
    clearTimeout(readyWatchdog)
    state = 'connected'
    qrDataUrl = null
    me = { phone: client.info?.wid?.user ?? '', name: client.info?.pushname ?? '' }
    log(`Connected as +${me.phone}`)
  })
  client.on('auth_failure', (message) => {
    log('Authentication failure:', message)
    restart(10_000)
  })
  client.on('disconnected', (reason) => {
    log('Disconnected:', reason)
    restart(5_000)
  })
  client.on('message', (message) => forwardIncoming(message).catch((error) => log('Incoming forward failed:', error.message)))

  client.initialize().catch((error) => {
    log('Initialization failed:', error.message)
    restart(15_000)
  })
}

async function restart(delayMs) {
  if (restarting) return
  restarting = true
  clearTimeout(readyWatchdog)
  state = 'disconnected'
  qrDataUrl = null
  me = null
  try {
    await client?.destroy()
  } catch {
    /* browser may already be gone */
  }
  await sleep(delayMs)
  restarting = false
  startClient()
}

/** Resolves the sender's phone digits, whether WhatsApp identifies them by number (@c.us) or by LID (@lid). */
async function senderPhone(message) {
  const from = message.from ?? ''
  if (from.endsWith('@c.us')) return from.split('@')[0]
  if (from.endsWith('@lid')) {
    try {
      const [match] = await client.getContactLidAndPhone([from])
      if (match?.pn) return match.pn.split('@')[0]
    } catch {
      /* fall back below */
    }
  }
  const contact = await message.getContact().catch(() => null)
  return contact?.number ?? null
}

async function forwardIncoming(message) {
  if (!INCOMING_URL || message.fromMe || message.isStatus) return
  if ((message.from ?? '').endsWith('@g.us') || (message.from ?? '').endsWith('@broadcast')) return
  const phone = await senderPhone(message)
  if (!phone) return
  const body = message.body || `[${message.type}]`
  const response = await fetch(INCOMING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Token': TOKEN },
    body: JSON.stringify({ phone, body, id: message.id?._serialized ?? '', timestamp: message.timestamp }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) log('CRM rejected incoming message:', response.status)
}

// One send at a time, with a short "typing…" pause like a person would.
let sendChain = Promise.resolve()

/** Runs one step of a send; failures carry the step name so logs and the CRM say what broke. */
async function step(name, fn) {
  try {
    return await fn()
  } catch (error) {
    if (error.status) throw error
    log(`Send step "${name}" failed:`, error.stack ?? error.message)
    throw Object.assign(new Error(`${name}_failed: ${String(error.message).slice(0, 120)}`), { status: 502 })
  }
}

/** "typing…" straight from the address (no chat lookup, which recent WhatsApp Web updates break). */
async function setTyping(chatId, typing) {
  try {
    await client.pupPage.evaluate((state, id) => window.WWebJS.sendChatstate(state, id), typing ? 'typing' : 'stop', chatId)
  } catch (error) {
    log('Typing indicator skipped:', error.message)
  }
}

function send(phone, text) {
  const run = async () => {
    if (state !== 'connected') throw Object.assign(new Error('not_connected'), { status: 409 })
    const digits = String(phone).replace(/\D/g, '')
    const numberId = await step('lookup', () => client.getNumberId(digits))
    if (!numberId) throw Object.assign(new Error('not_on_whatsapp'), { status: 422 })

    // WhatsApp now often addresses people by an internal id (@lid) rather than by phone
    // (@c.us). Use the address WhatsApp returned first, then the phone address. The library
    // returns nothing (and sends nothing) when it can't open the chat, so falling back to the
    // second address can never produce a duplicate.
    const targets = [...new Set([numberId._serialized, `${digits}@c.us`])]
    await setTyping(targets[0], true)
    await sleep(randomBetween(1500, 4000))
    for (const chatId of targets) {
      // sendSeen (mark as read) is the part most often broken by WhatsApp Web updates.
      const sent = await step('send', () => client.sendMessage(chatId, text, { sendSeen: false }))
      if (sent) {
        await setTyping(chatId, false)
        return { id: sent.id?._serialized ?? '' }
      }
      log(`Chat not available via @${chatId.split('@')[1]}`)
    }
    throw Object.assign(new Error('send_failed: chat_unavailable'), { status: 502 })
  }
  const result = sendChain.then(run, run)
  sendChain = result.catch(() => {})
  return result
}

/** Lookup only (nothing is sent): is this number on WhatsApp? */
async function check(phone) {
  if (state !== 'connected') throw Object.assign(new Error('not_connected'), { status: 409 })
  const digits = String(phone).replace(/\D/g, '')
  const numberId = await step('lookup', () => client.getNumberId(digits))
  if (!numberId) return { exists: false, id: null, chat: null }
  // Can a chat be opened (like opening a conversation in WhatsApp Web)? Nothing is sent.
  const chat = {}
  for (const chatId of [...new Set([numberId._serialized, `${digits}@c.us`])]) {
    chat[chatId.split('@')[1]] = await client.pupPage
      .evaluate(async (id) => Boolean(await window.WWebJS.getChat(id, { getAsModel: false })), chatId)
      .catch((error) => `error: ${String(error.message).slice(0, 80)}`)
  }
  return { exists: true, id: numberId._serialized, chat }
}

// ---------------------------------------------------------------- Chats (inbox)
//
// Read straight from WhatsApp Web's collections: the library's getChats() /
// fetchMessages() serialize through models that recent WhatsApp Web updates break.
// Nothing is stored here; the CRM reads these live.

const CHAT_ID = /^[\w.-]+@(c\.us|lid)$/ // one-to-one chats only (no groups)

function requireConnected() {
  if (state !== 'connected') throw Object.assign(new Error('not_connected'), { status: 409 })
}

async function listChats(limit) {
  requireConnected()
  return step('chats', () =>
    client.pupPage.evaluate(async (max) => {
      const { Chat } = window.require('WAWebCollections')
      const SYSTEM = new Set(['e2e_notification', 'notification_template', 'gp2', 'protocol', 'call_log', 'ciphertext'])
      const TEXT = new Set(['chat', 'automated_greeting_message', 'away_message'])
      const preview = (m) => ({
        // Media messages keep a base64 thumbnail in `body`: only their caption is text.
        body: (TEXT.has(m.type) ? m.body : m.caption) ?? '',
        type: m.type,
        fromMe: Boolean(m.id?.fromMe),
        t: m.t ?? null,
      })
      const phoneOf = async (chat) => {
        if (chat.id.server === 'c.us') return chat.id.user
        try {
          const { phone } = await window.WWebJS.enforceLidAndPnRetrieval(chat.id._serialized)
          return phone?.user ?? (phone ? String(phone._serialized ?? phone).split('@')[0] : null)
        } catch {
          return null
        }
      }
      const chats = Chat.getModelsArray()
        .filter((chat) => !chat.isGroup && ['c.us', 'lid'].includes(chat.id?.server))
        .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
        .slice(0, max)
      const result = []
      for (const chat of chats) {
        const messages = (chat.msgs?.getModelsArray?.() ?? []).filter((m) => !SYSTEM.has(m.type))
        const last = messages[messages.length - 1]
        result.push({
          id: chat.id._serialized,
          name: chat.formattedTitle || chat.name || chat.contact?.pushname || null,
          unread: chat.unreadCount ?? 0,
          t: chat.t ?? null,
          phone: await phoneOf(chat),
          last: last ? preview(last) : null,
        })
      }
      return result
    }, limit),
  )
}

async function listMessages(chatId, limit) {
  requireConnected()
  const messages = await step('messages', () =>
    client.pupPage.evaluate(
      async (id, max) => {
        const { Chat } = window.require('WAWebCollections')
        const chat = Chat.get(window.require('WAWebWidFactory').createWid(id))
        if (!chat) return null
        const SYSTEM = new Set(['e2e_notification', 'notification_template', 'gp2', 'protocol', 'call_log', 'ciphertext'])
        const TEXT = new Set(['chat', 'automated_greeting_message', 'away_message'])
        let msgs = chat.msgs.getModelsArray()
        if (msgs.length < max) {
          try {
            const earlier = await window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat })
            if (earlier?.length) msgs = [...earlier, ...msgs]
          } catch {
            /* older history not available: show what is loaded */
          }
        }
        return msgs
          .filter((m) => !SYSTEM.has(m.type))
          .sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
          .slice(-max)
          .map((m) => ({
            id: m.id._serialized,
            fromMe: Boolean(m.id.fromMe),
            body: (TEXT.has(m.type) ? m.body : m.caption) ?? '',
            type: m.type,
            t: m.t ?? null,
            ack: m.ack ?? null,
          }))
      },
      chatId,
      limit,
    ),
  )
  if (!messages) throw Object.assign(new Error('chat_not_found'), { status: 404 })
  return messages
}

/** Phone digits behind a chat id (@c.us carries them; @lid needs a lookup). */
async function chatPhone(chatId) {
  if (chatId.endsWith('@c.us')) return chatId.split('@')[0]
  try {
    const [match] = await client.getContactLidAndPhone([chatId])
    return match?.pn ? match.pn.split('@')[0] : null
  } catch {
    return null
  }
}

/** Reply inside an existing conversation (interactive: no queue, short typing pause). */
function sendToChat(chatId, text) {
  const run = async () => {
    requireConnected()
    await setTyping(chatId, true)
    await sleep(randomBetween(800, 2000))
    const sent = await step('send', () => client.sendMessage(chatId, text, { sendSeen: false }))
    await setTyping(chatId, false)
    if (!sent) throw Object.assign(new Error('send_failed: chat_unavailable'), { status: 502 })
    return { id: sent.id?._serialized ?? '', phone: await chatPhone(chatId) }
  }
  const result = sendChain.then(run, run)
  sendChain = result.catch(() => {})
  return result
}

// ---------------------------------------------------------------- HTTP API

function authorized(request) {
  const given = Buffer.from(String(request.headers['x-gateway-token'] ?? ''))
  const expected = Buffer.from(TOKEN)
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(Object.assign(new Error('payload_too_large'), { status: 413 }))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(Object.assign(new Error('invalid_json'), { status: 400 }))
      }
    })
    request.on('error', reject)
  })
}

function reply(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = http.createServer(async (request, response) => {
  const { pathname, searchParams } = new URL(request.url ?? '/', 'http://gateway')
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  try {
    if (request.method === 'GET' && pathname === '/healthz') return reply(response, 200, { ok: true })
    if (!authorized(request)) return reply(response, 401, { error: 'unauthorized' })

    if (request.method === 'GET' && pathname === '/status') {
      return reply(response, 200, { state, qr: qrDataUrl, me })
    }
    if (request.method === 'POST' && pathname === '/send') {
      const { phone, text } = await readJson(request)
      if (!phone || !text) return reply(response, 400, { error: 'phone_and_text_required' })
      return reply(response, 200, await send(phone, String(text)))
    }
    if (request.method === 'GET' && pathname === '/debug') {
      // Diagnostics without reading chats: page title, dialog text, loading progress.
      const page = client?.pupPage
      const info = page
        ? await page
            .evaluate(() => ({
              title: document.title,
              dialog: document.querySelector('[role="dialog"]')?.innerText?.slice(0, 300) ?? null,
              progress: document.querySelector('progress')?.value ?? null,
              startup: document.querySelector('#app')?.innerText?.slice(0, 200) ?? null,
              waVersion: window.Debug?.VERSION ?? null,
              injected: Boolean(window.WWebJS),
            }))
            .catch((error) => ({ error: error.message }))
        : null
      return reply(response, 200, { state, page: info })
    }
    if (request.method === 'POST' && pathname === '/check') {
      const { phone } = await readJson(request)
      if (!phone) return reply(response, 400, { error: 'phone_required' })
      return reply(response, 200, await check(phone))
    }
    if (request.method === 'GET' && pathname === '/chats') {
      return reply(response, 200, { chats: await listChats(limit) })
    }
    const chatRoute = pathname.match(/^\/chats\/([^/]+)\/(messages|send)$/)
    if (chatRoute) {
      const chatId = decodeURIComponent(chatRoute[1])
      if (!CHAT_ID.test(chatId)) return reply(response, 400, { error: 'invalid_chat' })
      if (request.method === 'GET' && chatRoute[2] === 'messages') {
        return reply(response, 200, { messages: await listMessages(chatId, limit) })
      }
      if (request.method === 'POST' && chatRoute[2] === 'send') {
        const { text } = await readJson(request)
        if (!text || !String(text).trim()) return reply(response, 400, { error: 'text_required' })
        return reply(response, 200, await sendToChat(chatId, String(text)))
      }
    }
    if (request.method === 'POST' && pathname === '/logout') {
      if (state === 'connected') await client.logout().catch((error) => log('Logout error:', error.message))
      restart(2_000)
      return reply(response, 200, { ok: true })
    }
    return reply(response, 404, { error: 'not_found' })
  } catch (error) {
    if (!error.status) log('Request failed:', pathname, error.message)
    return reply(response, error.status ?? 500, { error: error.status ? error.message : 'internal_error' })
  }
})

server.listen(PORT, () => log(`Gateway listening on :${PORT}`))
startClient()

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    log('Shutting down')
    server.close()
    await client?.destroy().catch(() => {})
    process.exit(0)
  })
}
