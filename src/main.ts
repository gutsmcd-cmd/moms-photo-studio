import './style.css'
import { newCanvas, ctx2d, clone, fitSize, scaled, brightness, FILTERS, mapPixels, rotate, flip, crop, redEye, blur, artFilter, type C } from './ops'
import { removeThings, subjectMask, sharpen, paintOnline, STYLE_PROMPTS } from './ai'

const MAX = 2048
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T
const PINK = '#e85d9a', GREEN = '#2e8b57'
const SWATCHES = [['White', '#ffffff'], ['Black', '#222222'], ['Pink', PINK], ['Green', GREEN], ['Yellow', '#ffd23f'], ['Blue', '#3a86ff'], ['Red', '#e63946']]

$('#app').innerHTML = `
<header>
  <button id="undo" class="top" disabled>↩️ Undo</button>
  <h1>🌸 Photo Studio</h1>
  <button id="newphoto" class="top">📂 New photo</button>
</header>
<section id="home">
  <p class="hello">Hello! Pick a photo to start.</p>
  <button id="open" class="huge">🖼️ Open my photo</button>
  <p class="small">Free. No ads. No sign-in. Your photos stay on your device unless you use the online painter.</p>
</section>
<section id="stage" hidden><canvas id="view"></canvas></section>
<section id="panel" hidden></section>
<nav id="tabs" hidden>
  <button data-tab="fix">🔧<span>Fix</span></button>
  <button data-tab="add">➕<span>Add</span></button>
  <button data-tab="style">🎨<span>Style</span></button>
  <button data-tab="done">✅<span>Done</span></button>
</nav>
<div id="busy" hidden><div class="box"><div class="spin"></div><p id="busytext">Working…</p></div></div>
<input type="file" id="file" accept="image/*" hidden>
<input type="file" id="file2" accept="image/*" hidden>`

const view = $<HTMLCanvasElement>('#view'), vg = ctx2d(view)
const panel = $('#panel')
let cur: C | null = null
const hist: C[] = []

// ---------- session = the tool currently open ----------
type P = { x: number; y: number }
interface Session {
  preview?: C
  draw?(g: CanvasRenderingContext2D): void
  down?(p: P): void; move?(p: P): void; up?(): void
}
let session: Session | null = null

function render() {
  if (!cur) return
  const base = session?.preview ?? cur
  if (view.width !== base.width || view.height !== base.height) { view.width = base.width; view.height = base.height }
  vg.clearRect(0, 0, view.width, view.height)
  vg.drawImage(base, 0, 0)
  session?.draw?.(vg)
  $<HTMLButtonElement>('#undo').disabled = !hist.length && !session
}
function commit(c: C) { if (cur) { hist.push(cur); if (hist.length > 15) hist.shift() } cur = c; render() }

$('#undo').onclick = () => {
  if (session) { closeTool(); return }
  const p = hist.pop(); if (p) { cur = p; render() }
}

// ---------- busy overlay ----------
async function busy<T>(text: string, job: (set: (t: string) => void) => Promise<T>): Promise<T | undefined> {
  $('#busy').hidden = false; $('#busytext').textContent = text
  await new Promise(r => setTimeout(r, 30))
  try { return await job(t => ($('#busytext').textContent = t)) }
  finally { $('#busy').hidden = true }
}
function say(msg: string) { const n = panel.querySelector('.msg'); if (n) n.textContent = msg }

// ---------- opening photos ----------
async function loadFile(f: File, max = MAX): Promise<C> {
  const bmp = await createImageBitmap(f)
  const s = fitSize(bmp.width, bmp.height, max)
  return scaled(bmp, s.w, s.h)
}
$('#open').onclick = $('#newphoto').onclick = () => $<HTMLInputElement>('#file').click()
$<HTMLInputElement>('#file').onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''
  if (!f) return
  try {
    const c = await loadFile(f)
    if (cur && !confirm('Start again with this new photo? (Your changes to the old one will be gone unless you saved them.)')) return
    hist.length = 0; cur = c; session = null
    $('#home').hidden = true; $('#stage').hidden = false; $('#tabs').hidden = false; $('#panel').hidden = false
    showTab('fix'); render()
  } catch { alert('Sorry, that file could not be opened as a picture.') }
}

// ---------- pointer on the picture ----------
function pt(e: PointerEvent): P { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * view.width, y: (e.clientY - r.top) / r.height * view.height } }
let dragging = false
view.addEventListener('pointerdown', e => { if (!session?.down) return; dragging = true; view.setPointerCapture(e.pointerId); session.down(pt(e)); render(); e.preventDefault() })
view.addEventListener('pointermove', e => { if (!dragging || !session?.move) return; session.move(pt(e)); render() })
const end = () => { if (!dragging) return; dragging = false; session?.up?.(); render() }
view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end)

// ---------- tabs and tools ----------
type Tool = { id: string; icon: string; label: string; tip: string; open(): void }
const TOOLS: Record<string, Tool[]> = { fix: [], add: [], style: [], done: [] }
let tab = 'fix'
function showTab(t: string) {
  tab = t; session = null
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t))
  panel.innerHTML = `<div class="grid">${TOOLS[t].map(x => `<button class="tool" data-id="${x.id}"><b>${x.icon}</b>${x.label}</button>`).join('')}</div>`
  panel.querySelectorAll<HTMLButtonElement>('.tool').forEach(b => b.onclick = () => openTool(TOOLS[t].find(x => x.id === b.dataset.id)!))
  render()
}
document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab!))

function openTool(t: Tool) {
  session = {}
  const seen = localStorage.getItem('tip-' + t.id)
  panel.innerHTML = `<div class="toolhead"><b>${t.icon} ${t.label}</b></div>
    ${seen ? '' : `<div class="tip">💡 ${t.tip} <button class="gotit">Got it</button></div>`}
    <div class="body"></div><p class="msg"></p>`
  panel.querySelector<HTMLButtonElement>('.gotit')?.addEventListener('click', ev => { localStorage.setItem('tip-' + t.id, '1'); (ev.target as HTMLElement).parentElement!.remove() })
  t.open(); render()
}
function closeTool() { showTab(tab) }
function body() { return panel.querySelector('.body') as HTMLElement }
/** Done / Cancel row. */
function actions(applyLabel: string, onApply: () => void | Promise<void>, cancelLabel = '✖ Cancel') {
  const row = document.createElement('div'); row.className = 'row actions'
  row.innerHTML = `<button class="cancel">${cancelLabel}</button><button class="apply">${applyLabel}</button>`
  row.querySelector<HTMLButtonElement>('.cancel')!.onclick = closeTool
  row.querySelector<HTMLButtonElement>('.apply')!.onclick = async () => { await onApply() }
  body().appendChild(row)
}
function slider(label: string, min: number, max: number, val: number, on: (v: number) => void) {
  const w = document.createElement('label'); w.className = 'slider'
  w.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" value="${val}">`
  const inp = w.querySelector('input')!; let raf = 0
  inp.oninput = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => on(+inp.value)) }
  body().appendChild(w); return inp
}
function buttons(list: [string, () => void][], cls = 'row') {
  const r = document.createElement('div'); r.className = cls
  for (const [l, f] of list) { const b = document.createElement('button'); b.innerHTML = l; b.onclick = () => { r.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); f() }; r.appendChild(b) }
  body().appendChild(r); return r
}
function colorRow(on: (c: string) => void, start = 0) {
  const r = document.createElement('div'); r.className = 'swatches'
  SWATCHES.forEach(([n, c], i) => { const b = document.createElement('button'); b.title = n; b.setAttribute('aria-label', n); b.style.background = c; if (i === start) b.classList.add('on'); b.onclick = () => { r.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); on(c) }; r.appendChild(b) })
  body().appendChild(r)
}

// ---------- FIX ----------
TOOLS.fix.push({ id: 'crop', icon: '✂️', label: 'Crop', tip: 'Drag the corners of the box. Everything outside the box will be cut off. Drag the middle to move the box.', open() {
  const c = cur!; const m = Math.min(c.width, c.height)
  const r = { x: c.width * 0.05, y: c.height * 0.05, w: c.width * 0.9, h: c.height * 0.9 }
  let mode = '', last: P = { x: 0, y: 0 }
  const H = m * 0.06
  session!.draw = g => {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.rect(0, 0, c.width, c.height); g.rect(r.x, r.y + r.h, r.w, -r.h); g.fill('evenodd')
    g.strokeStyle = '#fff'; g.lineWidth = m / 200; g.strokeRect(r.x, r.y, r.w, r.h)
    g.fillStyle = PINK
    for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) { g.beginPath(); g.arc(x, y, H / 2, 0, 7); g.fill(); g.stroke() }
  }
  session!.down = p => {
    last = p; mode = ''
    const cs: [string, number, number][] = [['tl', r.x, r.y], ['tr', r.x + r.w, r.y], ['bl', r.x, r.y + r.h], ['br', r.x + r.w, r.y + r.h]]
    for (const [n, x, y] of cs) if (Math.hypot(p.x - x, p.y - y) < H * 1.5) mode = n
    if (!mode && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) mode = 'move'
  }
  session!.move = p => {
    const dx = p.x - last.x, dy = p.y - last.y; last = p; const min = m * 0.08
    if (mode === 'move') { r.x = Math.min(Math.max(0, r.x + dx), c.width - r.w); r.y = Math.min(Math.max(0, r.y + dy), c.height - r.h) }
    if (mode.includes('l')) { const nx = Math.min(Math.max(0, r.x + dx), r.x + r.w - min); r.w += r.x - nx; r.x = nx }
    if (mode.includes('r')) r.w = Math.min(Math.max(min, r.w + dx), c.width - r.x)
    if (mode.includes('t')) { const ny = Math.min(Math.max(0, r.y + dy), r.y + r.h - min); r.h += r.y - ny; r.y = ny }
    if (mode.includes('b')) r.h = Math.min(Math.max(min, r.h + dy), c.height - r.y)
  }
  actions('✔ Cut it', () => { session = null; commit(crop(c, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })); closeTool() })
} })

TOOLS.fix.push({ id: 'turn', icon: '🔄', label: 'Turn', tip: 'Each tap turns the picture a quarter turn. "Mirror" flips it left to right.', open() {
  buttons([['↺ Turn left', () => commit(rotate(cur!, -1))], ['↻ Turn right', () => commit(rotate(cur!, 1))], ['⇋ Mirror', () => commit(flip(cur!))]])
  actions('✔ Finished', closeTool, '⬅ Back')
} })

TOOLS.fix.push({ id: 'light', icon: '☀️', label: 'Brighter or darker', tip: 'Slide right to make the picture brighter, left to make it darker.', open() {
  const c = cur!
  slider('🌑 Darker · Brighter ☀️', -100, 100, 0, v => { session!.preview = brightness(c, v); render() })
  actions('✔ Keep it', () => { const p = session!.preview; session = null; if (p) commit(p); closeTool() })
} })

TOOLS.fix.push({ id: 'filters', icon: '🌈', label: 'Color filters', tip: 'Tap a look to try it. Tap "Keep it" if you like it.', open() {
  const c = cur!
  buttons([['Normal', () => { session!.preview = undefined; render() }], ...Object.keys(FILTERS).map(k => [k, () => { session!.preview = mapPixels(c, FILTERS[k]); render() }] as [string, () => void])], 'row wrap')
  actions('✔ Keep it', () => { const p = session!.preview; session = null; if (p) commit(p); closeTool() })
} })

TOOLS.fix.push({ id: 'redeye', icon: '👁️', label: 'Fix red eyes', tip: 'Tap right on each red eye. If nothing changes, make the circle bigger and tap again.', open() {
  let size = 3, hover: P | null = null
  slider('Circle size', 1, 10, size, v => { size = v; render() })
  session!.draw = g => { if (!hover) return; const r = Math.min(view.width, view.height) * size / 100; g.strokeStyle = PINK; g.lineWidth = r / 6; g.beginPath(); g.arc(hover.x, hover.y, r, 0, 7); g.stroke() }
  session!.down = p => { hover = p; const c = clone(cur!); redEye(c, p.x, p.y, Math.min(c.width, c.height) * size / 100); const s = session; commit(c); session = s; say('Fixed. Tap the other eye, or tap Finished.') }
  actions('✔ Finished', closeTool, '⬅ Back')
} })

TOOLS.fix.push({ id: 'remove', icon: '🧽', label: 'Remove unwanted things', tip: 'Rub your finger over the thing you want gone, so it is covered in pink. Then tap "Remove it". The first time, it downloads a helper (about 200 MB), so Wi-Fi is best.', open() {
  const c = cur!; const mask = newCanvas(c.width, c.height); const mg = ctx2d(mask)
  let size = 4, last: P | null = null, any = false
  slider('Brush size', 1, 12, size, v => { size = v })
  const stroke = (a: P, b: P) => { mg.strokeStyle = PINK; mg.lineCap = mg.lineJoin = 'round'; mg.lineWidth = Math.min(c.width, c.height) * size / 100; mg.beginPath(); mg.moveTo(a.x, a.y); mg.lineTo(b.x, b.y); mg.stroke(); any = true }
  session!.down = p => { last = p; stroke(p, p) }
  session!.move = p => { if (last) stroke(last, p); last = p }
  session!.up = () => { last = null }
  session!.draw = g => { g.globalAlpha = 0.55; g.drawImage(mask, 0, 0); g.globalAlpha = 1 }
  buttons([['🧹 Clear the pink', () => { mg.clearRect(0, 0, c.width, c.height); any = false; render() }]])
  actions('✔ Remove it', async () => {
    if (!any) { say('First rub over the thing you want to remove.'); return }
    try { const r = await busy('Getting ready…', set => removeThings(c, mask, set)); if (r) { session = null; commit(r); closeTool() } }
    catch (e) { say('Sorry, that did not work. Check the internet (only needed the first time) and try again.'); console.error(e) }
  })
} })

TOOLS.fix.push({ id: 'blurbg', icon: '🌫️', label: 'Blur the background', tip: 'The app finds the person or main thing and makes the background soft. The first time, it downloads a helper (about 45 MB).', open() {
  const c = cur!; let mask: C | null = null; let amt = 12
  const make = () => { if (!mask) return; const out = blur(c, amt); const top = clone(c); const tg = ctx2d(top); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mask, 0, 0); ctx2d(out).drawImage(top, 0, 0); session!.preview = out; render() }
  slider('A little · A lot', 3, 40, amt, v => { amt = v; make() })
  actions('✔ Keep it', () => { const p = session!.preview; session = null; if (p) commit(p); closeTool() })
  busy('Finding the main thing in your photo…', set => subjectMask(c, set)).then(m => { if (m) { mask = m; make() } }).catch(e => { console.error(e); say('Sorry, that did not work. Check the internet (only needed the first time) and try again.') })
} })

TOOLS.fix.push({ id: 'sharp', icon: '🔍', label: 'Make it sharper', tip: 'Makes a blurry or small photo clearer. It can take a minute. The first time, it downloads a small helper.', open() {
  const c = cur!
  actions('✔ Make it sharper', async () => {
    try { const r = await busy('Getting ready…', set => sharpen(c, set)); if (r) { session = null; commit(r); closeTool() } }
    catch (e) { console.error(e); say('Sorry, that did not work. Check the internet (only needed the first time) and try again.') }
  })
} })

// ---------- ADD: movable things on top ----------
interface Thing { x: number; y: number; scale: number; rot: number; w: number; h: number; paint(g: CanvasRenderingContext2D): void }
function placeThing(t: Thing, applyLabel = '✔ Put it here') {
  let last: P | null = null
  const drawT = (g: CanvasRenderingContext2D) => { g.save(); g.translate(t.x, t.y); g.rotate(t.rot); g.scale(t.scale, t.scale); t.paint(g); g.restore() }
  session!.draw = g => { drawT(g); g.save(); g.translate(t.x, t.y); g.rotate(t.rot); g.setLineDash([12, 8]); g.strokeStyle = PINK; g.lineWidth = Math.max(2, view.width / 300); g.strokeRect(-t.w * t.scale / 2 - 6, -t.h * t.scale / 2 - 6, t.w * t.scale + 12, t.h * t.scale + 12); g.restore() }
  session!.down = p => { last = p }
  session!.move = p => { if (!last) return; t.x += p.x - last.x; t.y += p.y - last.y; last = p }
  session!.up = () => { last = null }
  slider('Size: smaller · bigger', 10, 300, 100, v => { t.scale = v / 100; render() })
  slider('Turn', -180, 180, 0, v => { t.rot = v * Math.PI / 180; render() })
  actions(applyLabel, () => { const c = clone(cur!); drawT(ctx2d(c)); session = null; commit(c); closeTool() })
  return drawT
}

TOOLS.add.push({ id: 'words', icon: '🔤', label: 'Words', tip: 'Type your words, pick a color, then drag the words with your finger to where you want them.', open() {
  const c = cur!; const fs = Math.min(c.width, c.height) * 0.09
  let text = 'Hello!', color = '#ffffff', box = false
  const t: Thing = { x: c.width / 2, y: c.height * 0.8, scale: 1, rot: 0, w: 10, h: fs * 1.3, paint(g) {
    g.font = `bold ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'
    const lines = text.split('\n'); const lw = Math.max(...lines.map(l => g.measureText(l).width)); this.w = lw + fs * 0.6; this.h = lines.length * fs * 1.25
    if (box) { g.fillStyle = color === '#ffffff' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.85)'; g.fillRect(-this.w / 2, -this.h / 2, this.w, this.h) }
    lines.forEach((l, i) => { const y = (i - (lines.length - 1) / 2) * fs * 1.25
      if (!box) { g.lineWidth = fs / 8; g.strokeStyle = color === '#222222' ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.6)'; g.lineJoin = 'round'; g.strokeText(l, 0, y) }
      g.fillStyle = color; g.fillText(l, 0, y) })
  } }
  const ta = document.createElement('textarea'); ta.value = text; ta.rows = 2; ta.placeholder = 'Type your words here'; ta.oninput = () => { text = ta.value || ' '; render() }
  body().appendChild(ta)
  colorRow(v => { color = v; render() })
  buttons([['No box', () => { box = false; render() }], ['Box behind words', () => { box = true; render() }]]).firstElementChild!.classList.add('on')
  placeThing(t)
} })

const SHAPES: Record<string, (g: CanvasRenderingContext2D, s: number) => void> = {
  'Circle': (g, s) => { g.beginPath(); g.arc(0, 0, s / 2, 0, 7) },
  'Square': (g, s) => { g.beginPath(); g.rect(-s / 2, -s / 2, s, s) },
  'Heart': (g, s) => { const k = s / 2; g.beginPath(); g.moveTo(0, k * 0.9); g.bezierCurveTo(-k * 1.3, 0, -k * 0.8, -k * 1.1, 0, -k * 0.45); g.bezierCurveTo(k * 0.8, -k * 1.1, k * 1.3, 0, 0, k * 0.9); g.closePath() },
  'Star': (g, s) => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.22 : s / 2, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r) } g.closePath() },
  'Arrow': (g, s) => { const k = s / 2; g.beginPath(); g.moveTo(-k, -k * 0.2); g.lineTo(k * 0.2, -k * 0.2); g.lineTo(k * 0.2, -k * 0.55); g.lineTo(k, 0); g.lineTo(k * 0.2, k * 0.55); g.lineTo(k * 0.2, k * 0.2); g.lineTo(-k, k * 0.2); g.closePath() },
}
TOOLS.add.push({ id: 'shapes', icon: '⭕', label: 'Shapes', tip: 'Pick a shape and a color. Drag it with your finger to move it. Use the sliders to make it bigger or turn it.', open() {
  const c = cur!; const s = Math.min(c.width, c.height) * 0.3
  let shape = 'Heart', color = PINK, fill = true
  const t: Thing = { x: c.width / 2, y: c.height / 2, scale: 1, rot: 0, w: s, h: s, paint(g) {
    SHAPES[shape](g, s)
    if (fill) { g.fillStyle = color; g.fill() } else { g.strokeStyle = color; g.lineWidth = s / 14; g.lineJoin = 'round'; g.stroke() }
  } }
  const icons: Record<string, string> = { Circle: '⭕', Square: '⬜', Heart: '❤️', Star: '⭐', Arrow: '➡️' }
  buttons(Object.keys(SHAPES).map(k => [`${icons[k]} ${k}`, () => { shape = k; render() }] as [string, () => void]), 'row wrap').children[2].classList.add('on')
  colorRow(v => { color = v; render() }, 2)
  buttons([['Filled in', () => { fill = true; render() }], ['Outline only', () => { fill = false; render() }]]).firstElementChild!.classList.add('on')
  placeThing(t)
} })

TOOLS.add.push({ id: 'addpic', icon: '🖼️', label: 'Add another picture', tip: 'Put a second picture, like a photo of one of your paintings, on top of this photo. You can cut out just the part you want.', open() {
  let pic: C | null = null
  const b = body()
  const choose = document.createElement('button'); choose.className = 'big'; choose.textContent = '📂 Choose the picture to add'
  b.appendChild(choose)
  const f2 = $<HTMLInputElement>('#file2')
  choose.onclick = () => f2.click()
  f2.onchange = async () => {
    const f = f2.files?.[0]; f2.value = ''; if (!f) return
    try { pic = await loadFile(f, 1600) } catch { say('Sorry, that file could not be opened.'); return }
    b.innerHTML = '<p>How much of this picture do you want?</p>'
    session!.preview = pic; render()
    buttons([
      ['🖼️ The whole picture', () => place(pic!)],
      ['✨ Cut it out for me', async () => {
        try { const m = await busy('Finding the main thing…', set => subjectMask(pic!, set)); if (!m) return; const o = clone(pic!); const g = ctx2d(o); g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0); place(trim(o)) }
        catch (e) { console.error(e); say('Sorry, that did not work. Try "Cut out with my finger".') }
      }],
      ['✍️ Cut out with my finger', () => lasso(pic!)],
    ], 'col')
    actions('✔', closeTool); (b.querySelector('.actions .apply') as HTMLElement).hidden = true
  }
  function lasso(p: C) {
    b.innerHTML = '<p>Draw a line all the way around the part you want, with your finger.</p>'
    const pts: P[] = []
    session = { preview: p,
      down: q => { pts.length = 0; pts.push(q) }, move: q => pts.push(q),
      draw: g => { if (pts.length < 2) return; g.strokeStyle = PINK; g.lineWidth = Math.max(3, p.width / 150); g.setLineDash([14, 10]); g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.stroke(); g.setLineDash([]) } }
    actions('✔ Use this part', () => {
      if (pts.length < 10) { say('Draw all the way around the part you want first.'); return }
      const o = newCanvas(p.width, p.height); const g = ctx2d(o); g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.clip(); g.drawImage(p, 0, 0)
      place(trim(o))
    })
  }
  function place(p: C) {
    const c = cur!; const s = Math.min(c.width * 0.5 / p.width, c.height * 0.5 / p.height)
    const sp = scaled(p, p.width * s, p.height * s)
    session = {}; b.innerHTML = '<p>Drag it with your finger to move it.</p>'
    placeThing({ x: c.width / 2, y: c.height / 2, scale: 1, rot: 0, w: sp.width, h: sp.height, paint(g) { g.drawImage(sp, -sp.width / 2, -sp.height / 2) } })
    render()
  }
} })
function trim(c: C): C {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? c : crop(c, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
}

// ---------- STYLE ----------
TOOLS.style.push({ id: 'paint', icon: '🎨', label: 'Paint my photo in a style', tip: 'Pick a look, or describe one. The free online painter (an AI on the internet) repaints your whole picture. It can take a minute or two. If it is busy, you can use the simple painter on this phone instead.', open() {
  const c = cur!; let look = 'Watercolour'
  buttons(Object.keys(STYLE_PROMPTS).map(k => [k, () => { look = k; ta.value = '' }] as [string, () => void]), 'row wrap').firstElementChild!.classList.add('on')
  const ta = document.createElement('textarea'); ta.rows = 2; ta.placeholder = 'Or describe a look, for example: "like a Van Gogh painting"'
  ta.oninput = () => { if (ta.value.trim()) body().querySelectorAll('.wrap button').forEach(x => x.classList.remove('on')) }
  body().appendChild(ta)
  const offline = () => {
    if (ta.value.trim() && !STYLE_PROMPTS[look]) look = 'Watercolour'
    busy('Painting with the simple painter…', async () => { await new Promise(r => setTimeout(r, 30)); return artFilter(c, look) }).then(r => { if (r) { session!.preview = r; render(); say('This is the simple painter (works on this phone, not AI). Tap "Keep it" if you like it.') } })
  }
  const go = document.createElement('button'); go.className = 'big'; go.textContent = '🎨 Paint it (free online AI)'
  go.onclick = async () => {
    const custom = ta.value.trim()
    const desc = custom ? `this style: ${custom}` : STYLE_PROMPTS[look]
    try { const r = await busy('Connecting…', set => paintOnline(c, desc, set)); if (r) { session!.preview = r; render(); say('Done! Tap "Keep it" if you like it, or try another look.') } }
    catch (e) { console.error(e); say('The free online painter is busy or has reached its daily limit. Try again later, or tap "Simple painter" below.') }
  }
  body().appendChild(go)
  buttons([['🖌️ Simple painter (on this phone, not AI)', offline]])
  actions('✔ Keep it', () => { const p = session!.preview; session = null; if (p) commit(p); closeTool() })
} })

// ---------- DONE ----------
const toBlob = (c: C) => new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/jpeg', 0.92))
const fname = () => `photo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jpg`
async function shareIt(saveMode: boolean) {
  const file = new File([await toBlob(cur!)], fname(), { type: 'image/jpeg' })
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
  if ((!saveMode || isApple) && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return } catch (e) { if ((e as Error).name === 'AbortError') return }
  }
  if (!saveMode) { say('Sharing is not available here. Tap "Save" instead, then send the saved photo.'); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  if (saveMode) say('Saved! Look for it in your Photos or Downloads.')
}
TOOLS.done.push({ id: 'save', icon: '💾', label: 'Save to my photos', tip: 'Saves your finished picture. On an iPhone or iPad, choose "Save Image" in the list that opens.', open() {
  actions('💾 Save', () => shareIt(true), '⬅ Back')
} })
TOOLS.done.push({ id: 'share', icon: '📤', label: 'Share or send', tip: 'Opens your phone’s list of apps, so you can send the picture by message, email and more.', open() {
  actions('📤 Share', () => shareIt(false), '⬅ Back')
} })
TOOLS.done.push({ id: 'print', icon: '🖨️', label: 'Print', tip: 'Opens the print screen. Pick your printer there.', open() {
  actions('🖨️ Print', () => { $<HTMLImageElement>('#printimg').src = cur!.toDataURL('image/jpeg', 0.92); setTimeout(() => window.print(), 300) }, '⬅ Back')
} })

if ('serviceWorker' in navigator) import('virtual:pwa-register').then(m => m.registerSW({ immediate: true })).catch(() => {})
// test hook
;(window as unknown as { __mps: unknown }).__mps = { get cur() { return cur }, hist }
