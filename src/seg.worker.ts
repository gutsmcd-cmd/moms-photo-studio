// Background-removal worker. BRIA RMBG-1.4 (quantized ONNX) run with onnxruntime-web (WASM), fully on-device.
import * as ort from 'onnxruntime-web/wasm'

const MODEL_URL = 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx'
const CACHE = 'mps-rmbg-v1'
const SIZE = 1024
ort.env.wasm.numThreads = 1
const device = 'wasm'

type Msg = { type: 'run'; bitmap: ImageBitmap } | { type: 'load' }
let sessP: Promise<ort.InferenceSession> | null = null

async function fetchModel(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(MODEL_URL)
  if (hit) return hit.arrayBuffer()
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error('download ' + res.status)
  const total = Number(res.headers.get('content-length')) || 44403226
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); got += value.length
    postMessage({ type: 'progress', loaded: got, total })
  }
  const buf = new Uint8Array(got); let o = 0
  for (const p of parts) { buf.set(p, o); o += p.length }
  await cache.put(MODEL_URL, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }))
  return buf.buffer
}

function load() {
  if (!sessP) {
    sessP = fetchModel().then((b) => ort.InferenceSession.create(b, { executionProviders: ['wasm'] }))
    sessP.catch(() => (sessP = null))
  }
  return sessP
}

async function run(bitmap: ImageBitmap) {
  const t0 = performance.now()
  const s = await load()
  const t1 = performance.now()
  const c = new OffscreenCanvas(SIZE, SIZE)
  const g = c.getContext('2d')!
  g.drawImage(bitmap, 0, 0, SIZE, SIZE)
  bitmap.close()
  const px = g.getImageData(0, 0, SIZE, SIZE).data
  const n = SIZE * SIZE
  const data = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    data[i] = px[i * 4] / 255 - 0.5
    data[n + i] = px[i * 4 + 1] / 255 - 0.5
    data[2 * n + i] = px[i * 4 + 2] / 255 - 0.5
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) })
  const raw = out[s.outputNames[0]].data as Float32Array
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < n; i++) { const v = raw[i]; if (v < mn) mn = v; if (v > mx) mx = v }
  const mask = new Uint8ClampedArray(n)
  const span = mx - mn || 1
  for (let i = 0; i < n; i++) mask[i] = ((raw[i] - mn) / span) * 255
  const t2 = performance.now()
  postMessage({ type: 'mask', mask, size: SIZE, device, loadMs: Math.round(t1 - t0), inferMs: Math.round(t2 - t1) }, { transfer: [mask.buffer] })
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  const p = m.type === 'load' ? load().then(() => postMessage({ type: 'ready', device })) : run(m.bitmap)
  p.catch((err: unknown) => postMessage({ type: 'error', message: String((err as Error)?.message ?? err) }))
}
