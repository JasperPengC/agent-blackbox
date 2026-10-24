#!/usr/bin/env node
/**
 * Prepare the DSH plugin package for publishing.
 *
 * The plugin runs the dashboard's HTTP router inside the DSH host process, so the
 * published package must carry the compiled core (dist/) and the static renderer
 * (web/). This script builds them and copies them into integrations/dsh-plugin:
 *
 *   core/     compiled server modules (dist/, including workers and adapters)
 *   web/      dashboard assets (served by core/server.js: WEB_ROOT = ../web)
 *   fixtures/ one synthetic session used when no local session exists
 *   LICENSE   copied from the repository root
 *
 * The generated directories are gitignored; `prepack` runs this script, so
 * `npm pack` and `npm publish` always produce a self-contained package.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN = join(ROOT, 'integrations', 'dsh-plugin')

const log = (message) => process.stdout.write(`  ${message}\n`)

function dirSize(path) {
  const st = statSync(path)
  if (!st.isDirectory()) return st.size
  return readdirSync(path).reduce((sum, name) => sum + dirSize(join(path, name)), 0)
}

process.stdout.write('▸ building core (tsc)\n')
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })

if (!existsSync(join(ROOT, 'dist', 'server.js'))) {
  throw new Error('dist/server.js is missing: run `npm run build` first')
}

for (const dir of ['core', 'web', 'fixtures']) {
  rmSync(join(PLUGIN, dir), { recursive: true, force: true })
  mkdirSync(join(PLUGIN, dir), { recursive: true })
}

process.stdout.write('▸ copying core\n')
cpSync(join(ROOT, 'dist'), join(PLUGIN, 'core'), { recursive: true })

process.stdout.write('▸ copying renderer\n')
cpSync(join(ROOT, 'web'), join(PLUGIN, 'web'), { recursive: true })

process.stdout.write('▸ copying fixture and license\n')
cpSync(join(ROOT, 'fixtures', 'mission-demo.ndjson'), join(PLUGIN, 'fixtures', 'mission-demo.ndjson'))
cpSync(join(ROOT, 'LICENSE'), join(PLUGIN, 'LICENSE'))

const payload = ['core', 'web', 'fixtures'].reduce((sum, dir) => sum + dirSize(join(PLUGIN, dir)), 0)
log(`payload: ${(payload / 1024).toFixed(0)} KB`)
log('plugin package ready')
