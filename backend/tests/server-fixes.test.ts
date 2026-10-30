import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-server-test-'))
process.env.SQLITE_PATH = path.join(temporary, 'test.sqlite3')
process.env.HUOBAO_DATA_DIR = temporary
process.env.MYSQL_AUTO_IMPORT = 'false'
const { buildProbe } = await import('../src/services/ai-config-probe.js')
const { VolcEngineImageAdapter } = await import('../src/services/adapters/volcengine-image.js')
const { VolcEngineVideoAdapter } = await import('../src/services/adapters/volcengine-video.js')
const { db, schema } = await import('../src/db/index.js')
const { clearFailedTasks, validCleanupIds } = await import('../src/services/task-cleanup.js')
const { eq } = await import('drizzle-orm')
after(() => {
  // The Windows SQLite connection may retain its file until process exit.
  const sqlite = (db as any).$client
  sqlite?.close()
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('Ark probes include the selected model and service-specific required fields', () => {
  for (const type of ['text', 'image', 'video']) {
    const probe = buildProbe(type, 'volcengine', 'https://example.test/api/v3', ' custom ', 'dummy')
    assert.equal(probe.body.model, 'custom')
    assert.equal(probe.headers.Authorization, 'Bearer dummy')
    if (type === 'text') assert.equal(probe.body.messages[0].content, 'Please reply OK.')
    if (type === 'image') assert.ok(probe.body.prompt)
    if (type === 'video') { assert.equal(probe.body.content[0].type, 'text'); assert.equal(probe.body.duration, 5) }
  }
})

test('Ark URLs accept host, prefix, pasted endpoint and proxy prefix', () => {
  for (const suffix of ['', '/api/v3', '/api/v3/responses', '/api/v3/images/generations/', '/api/v3/contents/generations/tasks']) {
    assert.equal(buildProbe('image', 'volcengine', 'https://example.test' + suffix, 'm').url, 'https://example.test/api/v3/images/generations')
  }
  assert.equal(buildProbe('video', 'volcengine', 'https://example.test/proxy/api/v3', 'm').url, 'https://example.test/proxy/api/v3/contents/generations/tasks')
})

test('image size and response IDs follow the image protocol', () => {
  const a = new VolcEngineImageAdapter()
  const request = a.buildGenerateRequest({ provider: 'volcengine', baseUrl: 'https://example.test', apiKey: 'dummy', model: 'custom' }, { id: 1, prompt: 'test', size: '2048x2048' })
  assert.equal(request.body.size, '2048x2048'); assert.equal(request.body.width, undefined)
  assert.equal(a.parseGenerateResponse({ id: 'request-id', data: [{ url: 'https://example.test/a.png' }] }).isAsync, false)
  assert.equal(a.parseGenerateResponse({ task_id: 'async-id' }).taskId, 'async-id')
})

test('Seedance accepts custom and endpoint IDs and parses asynchronous completion', () => {
  const a = new VolcEngineVideoAdapter()
  for (const model of ['doubao-seedance-2-5-example', 'ep-example']) {
    const request = a.buildGenerateRequest({ provider: 'volcengine', baseUrl: 'https://example.test', apiKey: 'dummy', model }, { id: 1, prompt: 'test', duration: 5 })
    assert.equal(request.body.model, model)
  }
  assert.equal(a.parseGenerateResponse({ id: 'task-id' }).taskId, 'task-id')
  assert.equal(a.parsePollResponse({ status: 'succeeded', content: { video_url: 'https://example.test/a.mp4' } }).videoUrl, 'https://example.test/a.mp4')
})

test('cleanup with real SQLite removes only selected failed tasks, including merges', () => {
  for (const [id, status] of [[101, 'failed'], [102, 'processing'], [103, 'completed'], [104, 'pending'], [105, 'failed']] as const) {
    db.insert(schema.sysTask).values({ id, type: 'image', status, createdAt: 'test', updatedAt: 'test' }).run()
    db.insert(schema.videoMerges).values({ id, status, provider: 'ffmpeg', model: 'merge', createdAt: 'test' }).run()
  }
  const result = clearFailedTasks([101, 102, 103, 104, 101], [101, 102, 103, 104])
  assert.deepEqual(result, { task_ids: [101], merge_ids: [101], count: 2 })
  for (const table of [schema.sysTask, schema.videoMerges]) assert.deepEqual(db.select({ id: table.id }).from(table).all().map(r => r.id), [102, 103, 104, 105])
  db.update(schema.sysTask).set({ status: 'processing' }).where(eq(schema.sysTask.id, 105)).run()
  assert.equal(clearFailedTasks([105], []).count, 0)
  assert.equal(clearFailedTasks([101], [101]).count, 0)
  assert.equal(clearFailedTasks([], []).count, 0)
})

test('cleanup rejects malformed and oversized ID lists', () => {
  for (const value of [null, undefined, ['1'], [-1], [0], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array(10001).fill(1)]) assert.equal(validCleanupIds(value), false)
  assert.equal(validCleanupIds([]), true)
  assert.equal(validCleanupIds([1, 2]), true)
})

test('both cleanup tables roll back together when one deletion fails', () => {
  db.insert(schema.sysTask).values({ id: 106, type: 'image', status: 'failed', createdAt: 'test', updatedAt: 'test' }).run()
  db.insert(schema.videoMerges).values({ id: 106, status: 'failed', provider: 'ffmpeg', model: 'merge', createdAt: 'test' }).run()
  const client = (db as any).$client
  client.exec("CREATE TRIGGER prevent_test_merge_delete BEFORE DELETE ON video_merges WHEN OLD.id=106 BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")
  try {
    assert.throws(() => clearFailedTasks([106], [106]))
    assert.equal(db.select().from(schema.sysTask).where(eq(schema.sysTask.id, 106)).all().length, 1)
  } finally { client.exec('DROP TRIGGER prevent_test_merge_delete') }
})

test('actual Hono test route forwards all service payloads to a local HTTP mock', async () => {
  const { default: routes } = await import('../src/routes/aiConfigs.js')
  let received: any
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    received = { path: req.url, body: JSON.parse(raw) }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"mock-task","data":[{"url":"https://example.test/a.png"}]}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as import('node:net').AddressInfo).port
    for (const type of ['text', 'image', 'video']) {
      const response = await routes.request('/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_type: type, provider: 'volcengine', model: ['selected-model'], base_url: `http://127.0.0.1:${port}/api/v3`, api_key: 'dummy' }) })
      assert.equal((await response.json() as any).data.ok, true); assert.equal(received.body.model, 'selected-model')
      const invalid = await routes.request('/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_type: type, provider: 'volcengine', model: [' '], base_url: 'https://example.test' }) })
      assert.equal(invalid.status, 400)
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('actual cleanup route validates IDs and preserves active/successful records', async () => {
  const { default: routes } = await import('../src/routes/tasks.js')
  const request = (body: unknown) => routes.request('/clear-failed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await request({ task_ids: ['102'], merge_ids: [] })).status, 400)
  const result = await request({ task_ids: [102, 103, 104, 106], merge_ids: [] })
  assert.equal(result.status, 200)
  assert.deepEqual((await result.json() as any).data.task_ids, [106])
  assert.equal(db.select().from(schema.sysTask).where(eq(schema.sysTask.id, 102)).get()?.status, 'processing')
  assert.equal(db.select().from(schema.sysTask).where(eq(schema.sysTask.id, 103)).get()?.status, 'completed')
})
