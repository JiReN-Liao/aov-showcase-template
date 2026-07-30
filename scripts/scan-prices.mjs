#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(process.env.AOV_LIBRARY_DIR || join(homedir(), 'AOVAccountLibrary'))
const python = resolve('.venv-price', 'Scripts', 'python.exe')
const recognizer = resolve('scripts', 'price-recognition', 'recognize_prices.py')
const output = resolve(process.env.AOV_PRICE_REPORT || 'price-recognition-report.json')
const styleRegistry = resolve('config', 'price-style-registry.json')

if (!existsSync(python)) {
  console.error('尚未安裝價格辨識環境，請先執行 npm run prices:setup。')
  process.exit(1)
}

const styleArgs = existsSync(styleRegistry) ? ['--style-registry', styleRegistry] : []
const child = spawn(python, [recognizer, '--directory', root, '--output', output, '--pretty', ...styleArgs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
