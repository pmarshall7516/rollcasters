import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const viteCli = path.resolve(path.dirname(require.resolve('vite')), '../../bin/vite.js')
const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
  cwd: path.resolve('.'),
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_GAME_PROFILE: 'local',
    VITE_GAME_CATALOG_MODE: 'live',
    VITE_GAME_LOCAL_CATALOG_PREVIEW: 'false',
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})
