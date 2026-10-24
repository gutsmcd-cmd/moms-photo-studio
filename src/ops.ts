// Plain canvas image operations (no AI). Everything runs on the phone.
export type C = HTMLCanvasElement

export function newCanvas(w: number, h: number): C {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  return c
}
export const ctx2d = (c: C) => c.getContext('2d', { willReadFrequently: true })!
export function clone(c: C): C { const d = newCanvas(c.width, c.height); ctx2d(d).drawImage(c, 0, 0); return d }

export function fitSize(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h)); return { w: Math.round(w * s), h: Math.round(h * s) }
}
export function scaled(src: CanvasImageSource & { width: number; height: number }, w: number, h: number): C {
  const c = newCanvas(w, h); const g = ctx2d(c); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h); return c
}

export function mapPixels(src: C, fn: (d: Uint8ClampedArray) => void): C {
  const out = clone(src); const g = ctx2d(out)
  const im = g.getImageData(0, 0, out.width, out.height); fn(im.data); g.putImageData(im, 0, 0); return out
}

export function brightness(src: C, amt: number): C { // amt -100..100
  const lut = new Uint8ClampedArray(256)
  const gamma = Math.pow(2, -amt / 60)
  for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, gamma)
  return mapPixels(src, d => { for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]] } })
}

export const FILTERS: Record<string, (d: Uint8ClampedArray) => void> = {
  'Black and white': d => { for (let i = 0; i < d.length; i += 4) { const y = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y } },
  'Old photo': d => { for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] = 0.393 * r + 0.769 * g + 0.189 * b; d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b; d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b } },
  'Warm': d => { for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * 1.1 + 10; d[i + 2] = d[i + 2] * 0.88 } },
  'Cool': d => { for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * 0.9; d[i + 2] = d[i + 2] * 1.1 + 10 } },
  'Bright colors': d => sat(d, 1.45),
  'Soft and faded': d => { sat(d, 0.7); for (let i = 0; i < d.length; i += 4) { d[i] = 30 + d[i] * 0.85; d[i + 1] = 30 + d[i + 1] * 0.85; d[i + 2] = 35 + d[i + 2] * 0.85 } },
}
function sat(d: Uint8ClampedArray, s: number) {
  for (let i = 0; i < d.length; i += 4) { const y = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; d[i] = y + (d[i] - y) * s; d[i + 1] = y + (d[i + 1] - y) * s; d[i + 2] = y + (d[i + 2] - y) * s }
}

export function rotate(src: C, dir: 1 | -1): C {
  const out = newCanvas(src.height, src.width); const g = ctx2d(out)
  g.translate(out.width / 2, out.height / 2); g.rotate(dir * Math.PI / 2); g.drawImage(src, -src.width / 2, -src.height / 2); return out
}
export function flip(src: C): C { const out = newCanvas(src.width, src.height); const g = ctx2d(out); g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return out }
export function crop(src: C, r: { x: number; y: number; w: number; h: number }): C {
  const out = newCanvas(r.w, r.h); ctx2d(out).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height); return out
}

/** Red-eye fix in a circle. Changes `c` in place. */
export function redEye(c: C, cx: number, cy: number, rad: number) {
  const x0 = Math.max(0, Math.floor(cx - rad)), y0 = Math.max(0, Math.floor(cy - rad))
  const x1 = Math.min(c.width, Math.ceil(cx + rad)), y1 = Math.min(c.height, Math.ceil(cy + rad))
  if (x1 <= x0 || y1 <= y0) return
  const g = ctx2d(c); const im = g.getImageData(x0, y0, x1 - x0, y1 - y0); const d = im.data
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue
    const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4
    const r = d[i], gg = d[i + 1], b = d[i + 2], avg = (gg + b) / 2
    if (r > 60 && r > avg * 1.4) { d[i] = avg * 0.9; d[i + 1] = gg * 0.9; d[i + 2] = b * 0.9 }
  }
  g.putImageData(im, x0, y0)
}

/** Cheap smooth blur: shrink then grow, twice. */
export function blur(src: C, amount: number): C {
  const k = Math.max(1.5, amount)
  let cur: C = src
  for (let p = 0; p < 2; p++) {
    const small = scaled(cur, Math.max(1, src.width / k), Math.max(1, src.height / k))
    cur = scaled(small, src.width, src.height)
  }
  return cur
}

/** Kuwahara painterly filter using integral images. */
function kuwahara(src: C, r: number): C {
  const w = src.width, h = src.height
  const im = ctx2d(src).getImageData(0, 0, w, h); const d = im.data
  const W = w + 1, n = W * (h + 1)
  const S = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  for (let y = 0; y < h; y++) {
    const s = [0, 0, 0, 0, 0]
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const R = d[i], G = d[i + 1], B = d[i + 2], L = 0.3 * R + 0.59 * G + 0.11 * B
      s[0] += R; s[1] += G; s[2] += B; s[3] += L; s[4] += L * L
      const o = (y + 1) * W + x + 1
      for (let k = 0; k < 5; k++) S[k][o] = S[k][o - W] + s[k]
    }
  }
  const sum = (k: number, x0: number, y0: number, x1: number, y1: number) => S[k][y1 * W + x1] - S[k][y0 * W + x1] - S[k][y1 * W + x0] + S[k][y0 * W + x0]
  const out = new ImageData(w, h); const o = out.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = Infinity, bi = 0, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0
    for (let q = 0; q < 4; q++) {
      const x0 = Math.max(0, q & 1 ? x : x - r), x1 = Math.min(w, (q & 1 ? x + r : x) + 1)
      const y0 = Math.max(0, q & 2 ? y : y - r), y1 = Math.min(h, (q & 2 ? y + r : y) + 1)
      const N = (x1 - x0) * (y1 - y0); const m = sum(3, x0, y0, x1, y1) / N
      const v = sum(4, x0, y0, x1, y1) / N - m * m
      if (v < best) { best = v; bi = N; bx0 = x0; by0 = y0; bx1 = x1; by1 = y1 }
    }
    const i = (y * w + x) * 4
    o[i] = sum(0, bx0, by0, bx1, by1) / bi; o[i + 1] = sum(1, bx0, by0, bx1, by1) / bi; o[i + 2] = sum(2, bx0, by0, bx1, by1) / bi; o[i + 3] = 255
  }
  const c = newCanvas(w, h); ctx2d(c).putImageData(out, 0, 0); return c
}

function edges(src: C, thresh: number): Uint8Array {
  const w = src.width, h = src.height; const d = ctx2d(src).getImageData(0, 0, w, h).data
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]
  const e = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const gx = L[i + 1 - w] + 2 * L[i + 1] + L[i + 1 + w] - L[i - 1 - w] - 2 * L[i - 1] - L[i - 1 + w]
    const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1]
    const m = Math.hypot(gx, gy); e[i] = m > thresh ? Math.min(255, m) : 0
  }
  return e
}

/** Simple offline "painting" looks. Not AI: classic picture filters. */
export function artFilter(src0: C, look: string): C {
  const fs = fitSize(src0.width, src0.height, 1100)
  const src = scaled(src0, fs.w, fs.h)
  let out: C
  const unit = Math.max(1, Math.round(Math.max(fs.w, fs.h) / 400))
  if (look === 'Pencil sketch') {
    const gray = mapPixels(src, FILTERS['Black and white'])
    const bl = blur(mapPixels(gray, d => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2] } }), 6)
    const bd = ctx2d(bl).getImageData(0, 0, fs.w, fs.h).data
    out = mapPixels(gray, d => { for (let i = 0; i < d.length; i += 4) { const v = Math.min(255, d[i] * 255 / Math.max(1, 255 - bd[i])); d[i] = d[i + 1] = d[i + 2] = v } })
  } else if (look === 'Cartoon') {
    out = kuwahara(src, 2 * unit)
    const e = edges(src, 140)
    out = mapPixels(out, d => { sat(d, 1.3); for (let i = 0; i < d.length; i += 4) { for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / 48) * 48 + 16; if (e[i / 4]) { d[i] = d[i + 1] = d[i + 2] = 30 } } })
  } else if (look === 'Pastel') {
    out = mapPixels(kuwahara(src, 2 * unit), d => { sat(d, 0.75); for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = 70 + d[i + k] * 0.75 })
  } else if (look === 'Oil painting') {
    out = mapPixels(kuwahara(src, 4 * unit), d => sat(d, 1.15))
  } else if (look === 'Acrylic') {
    out = mapPixels(kuwahara(src, 3 * unit), d => { sat(d, 1.35); for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / 24) * 24 })
  } else { // Watercolour
    const k = kuwahara(src, 3 * unit); const e = edges(k, 90)
    out = mapPixels(k, d => {
      sat(d, 0.9)
      for (let i = 0; i < d.length; i += 4) {
        const noise = (Math.random() - 0.5) * 14, ed = e[i / 4] ? 0.85 : 1
        for (let c = 0; c < 3; c++) d[i + c] = (40 + d[i + c] * 0.85) * ed + noise
      }
    })
  }
  return scaled(out, src0.width, src0.height)
}
