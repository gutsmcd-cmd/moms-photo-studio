// LaMa inpainting worker (onnxruntime-web, WASM). Model: Carve/LaMa-ONNX lama_fp32.onnx (Apache-2.0).
import * as ort from 'onnxruntime-web/wasm'

const MODEL_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
const CACHE = 'mps-lama-v1'
ort.env.wasm.numThreads = 1 // GitHub Pages has no cross-origin isolation

let session: ort.InferenceSession | null = null

async function loadModel(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(MODEL_URL)
  if (hit) return hit.arrayBuffer()
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error('download ' + res.status)
  const total = Number(res.headers.get('content-length')) || 208044816
  const reader = res.body.getReader()
  const buf = new Uint8Array(total)
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (got + value.length > buf.length) throw new Error('size')
    buf.set(value, got); got += value.length
    postMessage({ type: 'progress', got, total })
  }
  const data = buf.subarray(0, got)
  await cache.put(MODEL_URL, new Response(data, { headers: { 'content-type': 'application/octet-stream' } }))
  return data.buffer.slice(0, got) as ArrayBuffer
}

async function ensure() {
  if (session) return
  const model = await loadModel()
  postMessage({ type: 'loading' })
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
}

onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'cached') {
      const c = await caches.open(CACHE)
      postMessage({ type: 'cached', yes: !!(await c.match(MODEL_URL)) })
      return
    }
    if (m.type !== 'run') return
    await ensure()
    postMessage({ type: 'working' })
    const N = 512 * 512
    const rgba = m.rgba as Uint8ClampedArray, mk = m.mask as Uint8ClampedArray
    const img = new Float32Array(3 * N), mask = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      img[i] = rgba[i * 4] / 255; img[N + i] = rgba[i * 4 + 1] / 255; img[2 * N + i] = rgba[i * 4 + 2] / 255
      mask[i] = mk[i * 4 + 3] > 20 ? 1 : 0
    }
    const out = await session!.run({
      image: new ort.Tensor('float32', img, [1, 3, 512, 512]),
      mask: new ort.Tensor('float32', mask, [1, 1, 512, 512]),
    })
    const o = out.output.data as Float32Array
    const res = new Uint8ClampedArray(N * 4)
    for (let i = 0; i < N; i++) { res[i * 4] = o[i]; res[i * 4 + 1] = o[N + i]; res[i * 4 + 2] = o[2 * N + i]; res[i * 4 + 3] = 255 }
    postMessage({ type: 'done', rgba: res }, { transfer: [res.buffer] })
  } catch (err) {
    postMessage({ type: 'error', msg: String(err) })
  }
}
