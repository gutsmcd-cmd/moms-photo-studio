// Helpers that talk to the on-phone AI workers and the free online painter.
import { newCanvas, ctx2d, scaled, fitSize, type C } from './ops'

type Prog = (text: string) => void
const mb = (n: number) => Math.round(n / 1048576)

function once<T>(w: Worker, post: () => void, onProg: Prog, label: string, done: (m: any) => T | undefined): Promise<T> {
  return new Promise((res, rej) => {
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') {
        const got = m.got ?? m.loaded, total = m.total
        if (total) onProg(`First time only: getting the ${label} helper… ${mb(got)} of ${mb(total)} MB`)
      } else if (m.type === 'loading') onProg('Getting ready…')
      else if (m.type === 'working') onProg('Working on it…')
      else if (m.type === 'error') rej(new Error(m.msg || m.message))
      else { const r = done(m); if (r !== undefined) res(r) }
    }
    w.onerror = e => rej(new Error(e.message))
    post()
  })
}

// ---------- Remove unwanted things (LaMa, ~200 MB once) ----------
let lamaW: Worker | null = null
export async function removeThings(img: C, mask: C, onProg: Prog): Promise<C> {
  lamaW ??= new Worker(new URL('./lama.worker.ts', import.meta.url), { type: 'module' })
  // bounding box of the mask
  const md = ctx2d(mask).getImageData(0, 0, mask.width, mask.height).data
  let x0 = mask.width, y0 = mask.height, x1 = -1, y1 = -1
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (md[(y * mask.width + x) * 4 + 3] > 20) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) throw new Error('nothing marked')
  let side = Math.max(x1 - x0, y1 - y0) * 2 + 64
  side = Math.min(side, Math.max(img.width, img.height))
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rw = Math.min(side, img.width), rh = Math.min(side, img.height)
  const rx = Math.round(Math.min(Math.max(0, cx - rw / 2), img.width - rw)), ry = Math.round(Math.min(Math.max(0, cy - rh / 2), img.height - rh))
  const cut = (src: C) => { const c = newCanvas(512, 512); const g = ctx2d(c); g.imageSmoothingQuality = 'high'; g.drawImage(src, rx, ry, rw, rh, 0, 0, 512, 512); return g.getImageData(0, 0, 512, 512).data }
  const rgba = cut(img), mk = cut(mask)
  const out = await once<Uint8ClampedArray>(lamaW, () => lamaW!.postMessage({ type: 'run', rgba, mask: mk }), onProg, 'eraser (about 200 MB, Wi-Fi is best)', m => m.type === 'done' ? m.rgba : undefined)
  const res = newCanvas(512, 512); ctx2d(res).putImageData(new ImageData(new Uint8ClampedArray(out), 512, 512), 0, 0)
  // only paste the marked area back (slightly grown and softened)
  const patch = newCanvas(rw, rh); const pg = ctx2d(patch); pg.imageSmoothingQuality = 'high'
  pg.drawImage(res, 0, 0, rw, rh)
  const soft = newCanvas(rw, rh); const sg = ctx2d(soft)
  const grow = Math.max(3, Math.round(rw / 120))
  for (let dx = -grow; dx <= grow; dx += grow) for (let dy = -grow; dy <= grow; dy += grow) sg.drawImage(mask, rx, ry, rw, rh, dx, dy, rw, rh)
  pg.globalCompositeOperation = 'destination-in'; pg.drawImage(soft, 0, 0)
  const final = newCanvas(img.width, img.height); const fg = ctx2d(final); fg.drawImage(img, 0, 0); fg.drawImage(patch, rx, ry)
  return final
}

// ---------- Find the person / main subject (RMBG-1.4) ----------
let segW: Worker | null = null
/** Returns a mask canvas (white = subject, transparent = background) at the size of img. */
export async function subjectMask(img: C, onProg: Prog): Promise<C> {
  segW ??= new Worker(new URL('./seg.worker.ts', import.meta.url), { type: 'module' })
  const bmp = await createImageBitmap(img)
  const r = await once<{ mask: Uint8ClampedArray; size: number }>(segW, () => segW!.postMessage({ type: 'run', bitmap: bmp }, [bmp]), onProg, 'picture-finder (about 45 MB)', m => m.type === 'mask' ? m : undefined)
  const s = r.size; const mc = newCanvas(s, s); const id = new ImageData(s, s)
  for (let i = 0; i < s * s; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = r.mask[i] }
  ctx2d(mc).putImageData(id, 0, 0)
  return scaled(mc, img.width, img.height)
}

// ---------- Make it sharper (Real-ESRGAN x4, tiled) ----------
let esrW: Worker | null = null
export async function sharpen(img: C, onProg: Prog): Promise<C> {
  esrW ??= new Worker(new URL('./esrgan.worker.ts', import.meta.url), { type: 'module' })
  const fs = fitSize(img.width, img.height, 1200)
  const src = scaled(img, fs.w, fs.h)
  const outScale = Math.max(img.width, img.height) >= 1200 ? img.width / fs.w : 2 * img.width / fs.w
  const dst = newCanvas(fs.w * outScale, fs.h * outScale); const dg = ctx2d(dst); dg.imageSmoothingQuality = 'high'
  const T = 128, P = 8; const sg = ctx2d(src)
  const tiles: [number, number][] = []
  for (let y = 0; y < fs.h; y += T) for (let x = 0; x < fs.w; x += T) tiles.push([x, y])
  let n = 0
  for (const [x, y] of tiles) {
    const tw = Math.min(T, fs.w - x), th = Math.min(T, fs.h - y)
    const px0 = Math.max(0, x - P), py0 = Math.max(0, y - P), px1 = Math.min(fs.w, x + tw + P), py1 = Math.min(fs.h, y + th + P)
    const w = px1 - px0, h = py1 - py0
    const rgba = sg.getImageData(px0, py0, w, h).data
    const out = await once<Uint8ClampedArray>(esrW, () => esrW!.postMessage({ rgba, w, h }), t => onProg(t), 'sharpener (about 5 MB)', m => m.type === 'done' ? m.rgba : undefined)
    const tc = newCanvas(w * 4, h * 4); ctx2d(tc).putImageData(new ImageData(new Uint8ClampedArray(out), w * 4, h * 4), 0, 0)
    dg.drawImage(tc, (x - px0) * 4, (y - py0) * 4, tw * 4, th * 4, x * outScale, y * outScale, tw * outScale, th * outScale)
    onProg(`Making it sharper… ${Math.round(++n / tiles.length * 100)}%`)
  }
  return dst
}

// ---------- Paint in a style (free online AI on Hugging Face) ----------
export const STYLE_PROMPTS: Record<string, string> = {
  'Watercolour': 'a soft watercolour painting on textured paper, gentle washes of colour, visible brush blooms',
  'Acrylic': 'an acrylic painting with bold, thick, slightly textured brush strokes and rich colours',
  'Oil painting': 'a classic oil painting on canvas with visible brush strokes and rich, warm colours',
  'Pencil sketch': 'a detailed graphite pencil sketch on white paper, hand-drawn shading',
  'Pastel': 'a soft chalk pastel drawing with light, dreamy colours on paper',
  'Cartoon': 'a cheerful cartoon illustration with clean outlines and flat bright colours',
}
const SPACES: { id: string; key: string }[] = [
  { id: 'black-forest-labs/FLUX.1-Kontext-Dev', key: 'input_image' },
  { id: 'Qwen/Qwen-Image-Edit', key: 'image' },
]
export async function paintOnline(img: C, look: string, onProg: Prog): Promise<C> {
  const { Client } = await import('@gradio/client')
  const fs = fitSize(img.width, img.height, 1024)
  const small = scaled(img, fs.w, fs.h)
  const blob = await new Promise<Blob>(r => small.toBlob(b => r(b!), 'image/jpeg', 0.92))
  const prompt = `Repaint this whole picture as ${look}. Keep the same scene, people, objects and layout.`
  let lastErr: unknown = null
  for (const sp of SPACES) {
    try {
      onProg('Connecting to the free online painter…')
      const client = await Client.connect(sp.id)
      onProg('Painting… this can take a minute or two. Please keep this screen open.')
      const r = await Promise.race([
        client.predict('/infer', { [sp.key]: blob, prompt }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 240000)),
      ]) as { data: unknown[] }
      const first = r.data[0] as { url?: string } | string
      const url = typeof first === 'string' ? first : first?.url
      if (!url) throw new Error('no picture came back')
      const blobOut = await (await fetch(url)).blob()
      const bmp = await createImageBitmap(blobOut)
      return scaled(bmp, img.width, img.height)
    } catch (e) { lastErr = e }
  }
  throw lastErr ?? new Error('painter unavailable')
}
