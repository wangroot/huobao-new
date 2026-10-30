import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const exec = promisify(execFile)
const docker = async (...args) => (await exec('docker', args, { maxBuffer: 8 * 1024 * 1024 })).stdout.trim()
const suffix = `${Date.now()}-${process.pid}`
const name = `huobao-smoke-${suffix}`
const volume = `huobao-smoke-data-${suffix}`
const image = process.argv[2] || 'huobao-drama-custom:4.0.9-fixes'
const tests = fileURLToPath(new URL('../backend/tests', import.meta.url))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let created = false
try {
  await docker('volume', 'create', volume)
  created = true
  await docker('run', '-d', '--name', name, '--mount', `type=volume,src=${volume},dst=/app/data`, '--mount', `type=bind,src=${tests},dst=/app/backend/tests,readonly`, '-p', '127.0.0.1::5679', image)
  const address = (await docker('port', name, '5679/tcp')).split('\n')[0]
  let origin = `http://${address}`
  const ready = async () => {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(2000) })).ok) return } catch {}
      await delay(1000)
    }
    throw new Error('Container health check timed out')
  }
  await ready()
  for (const route of ['/settings', '/drama/1/episode/1']) assert.equal((await fetch(origin + route)).status, 200)
  assert.equal(await docker('exec', name, 'id', '-u'), '1000')
  const createdConfig = await fetch(`${origin}/api/v1/ai-configs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Docker persistence test', service_type: 'image', provider: 'volcengine', base_url: 'https://example.test', model: ['mock-model'], api_key: 'dummy-test-key' }),
  })
  assert.equal(createdConfig.status, 201)
  await docker('restart', name)
  origin = `http://${(await docker('port', name, '5679/tcp')).split('\n')[0]}`
  await ready()
  const configs = await fetch(`${origin}/api/v1/ai-configs`).then(r => r.json())
  assert.ok(configs.data.some(c => c.name === 'Docker persistence test'))
  await docker('exec', name, 'ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-t', '1', '-c:v', 'libx264', '-y', '/tmp/huobao-smoke.mp4')
  const duration = await docker('exec', name, 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '/tmp/huobao-smoke.mp4')
  assert.ok(Number(duration) >= 1)
  console.log(await docker('exec', '-w', '/app/backend', name, 'node', '--import', 'tsx', '--test', 'tests/server-fixes.test.ts'))
  console.log(JSON.stringify({ image, nonRoot: true, frontendRoutes: true, dataPersistsAfterRestart: true, ffmpegEncode: true, backendRegression: true, noPaidGeneration: true }))
} catch (error) {
  try { console.error(await docker('logs', '--tail', '60', name)) } catch {}
  throw error
} finally {
  if (created) {
    try { await docker('rm', '-f', name) } catch {}
    try { await docker('volume', 'rm', volume) } catch {}
  }
}
