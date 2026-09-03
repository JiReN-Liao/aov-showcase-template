#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const imageDirectory = process.env.AOV_IMAGE_DIR ? resolve(process.env.AOV_IMAGE_DIR) : null
const python = resolve('.venv-price', 'Scripts', 'python.exe')
const recognizer = resolve('scripts', 'price-recognition', 'recognize_prices.py')
const output = resolve(process.env.AOV_PRICE_REPORT || 'price-recognition-report.json')

if (!existsSync(python)) {
  console.error('尚未安裝價格辨識環境，請先執行 npm run prices:setup。')
  process.exit(1)
}

const directoryArgs = imageDirectory ? ['--directory', imageDirectory] : []
const child = spawn(python, [recognizer, '--output', output, '--pretty', ...directoryArgs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
