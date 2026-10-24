// Renders public/icon.svg into PNG app icons at build time (so no binary files live in the repo).
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const svg = readFileSync('public/icon.svg', 'utf8')
mkdirSync('public/icons', { recursive: true })
for (const s of [32, 180, 192, 512]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: s } }).render().asPng()
  writeFileSync(`public/icons/icon-${s}.png`, png)
}
console.log('icons ok')
