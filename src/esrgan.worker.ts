// Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact, BSD-3-Clause) via onnxruntime-web WASM, tiled.
import * as ort from 'onnxruntime-web/wasm'

const MODEL_URL = 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx'
const CACHE = 'mps-esrgan-v1'
ort.env.wasm.numThreads = 1 // GitHub Pages has no cross-origin isolation
let session: ort.InferenceSession | null = null

async function loadModel(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(MODEL_URL)
  if (hit) return hit.arrayBuffer()
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error('download ' + res.status)
  const total = Number(res.headers.get('content-length')) || 4866417
  const reader = res.body.getReader(); const parts: Uint8Array[] = []; let got = 0
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    parts.push(value); got += value.length; postMessage({ type: 'progress', got, total })
  }
  const data = new Uint8Array(got); let o = 0; for (const p of parts) { data.set(p, o); o += p.length }
  await cache.put(MODEL_URL, new Response(data, { headers: { 'content-type': 'application/octet-stream' } }))
  return data.buffer
}

// Input: one tile (RGBA, w×h). Output: 4x tile RGBA.
onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (!session) {
      const model = await loadModel(); postMessage({ type: 'loading' })
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    }
    const { rgba, w, h } = m as { rgba: Uint8ClampedArray; w: number; h: number }
    const N = w * h; const x = new Float32Array(3 * N)
    for (let i = 0; i < N; i++) { x[i] = rgba[i * 4] / 255; x[N + i] = rgba[i * 4 + 1] / 255; x[2 * N + i] = rgba[i * 4 + 2] / 255 }
    const out = await session.run({ input: new ort.Tensor('float32', x, [1, 3, h, w]) })
    const y = (out.output ?? Object.values(out)[0]).data as Float32Array
    const M = N * 16; const res = new Uint8ClampedArray(M * 4)
    for (let i = 0; i < M; i++) { res[i * 4] = y[i] * 255; res[i * 4 + 1] = y[M + i] * 255; res[i * 4 + 2] = y[2 * M + i] * 255; res[i * 4 + 3] = 255 }
    postMessage({ type: 'done', rgba: res }, { transfer: [res.buffer] })
  } catch (err) { postMessage({ type: 'error', msg: String(err) }) }
}
