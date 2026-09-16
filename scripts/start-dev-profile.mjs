import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { parse } from 'dotenv'

const profiles = {
  local: {
    envFile: '.env.development.local',
    viteMode: 'development',
    authMode: 'development',
  },
  auth: {
    envFile: '.env.auth.local',
    viteMode: 'auth',
    authMode: 'supabase',
  },
}

const profileName = process.argv[2]
const profile = profiles[profileName]

if (!profile) {
  throw new Error(`未知启动模式：${profileName ?? '未提供'}。可用值：local、auth`)
}

async function readEnvFile(fileName, required) {
  try {
    return parse(await readFile(fileName, 'utf8'))
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return {}
    if (error?.code === 'ENOENT') {
      throw new Error(`缺少 ${fileName}，无法启动 ${profileName} 模式`, { cause: error })
    }
    throw error
  }
}

function readPort(env, name) {
  const port = Number(env[name])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的整数`)
  }
  return port
}

function validateProfileEnvironment(env) {
  if (env.AUTH_MODE !== profile.authMode || env.VITE_AUTH_MODE !== profile.authMode) {
    throw new Error(
      `${profile.envFile} 必须同时设置 AUTH_MODE=${profile.authMode} 和 VITE_AUTH_MODE=${profile.authMode}`,
    )
  }

  const webPort = readPort(env, 'WEB_PORT')
  const apiPort = readPort(env, 'PORT')
  const expectedApiBaseUrl = `http://127.0.0.1:${apiPort}/api`

  if (env.VITE_API_BASE_URL !== expectedApiBaseUrl) {
    throw new Error(`VITE_API_BASE_URL 必须与后端端口一致：${expectedApiBaseUrl}`)
  }

  return { webPort, expectedApiBaseUrl }
}

const baseEnvironment = await readEnvFile('.env', false)
const profileEnvironment = await readEnvFile(profile.envFile, true)
const childEnvironment = {
  ...process.env,
  ...baseEnvironment,
  ...profileEnvironment,
}
const { webPort, expectedApiBaseUrl } = validateProfileEnvironment(childEnvironment)
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

console.log(`PERCH ${profileName} 模式`)
console.log(`前端：http://127.0.0.1:${webPort}`)
console.log(`后端：${expectedApiBaseUrl}`)

const children = [
  spawn(
    pnpmExecutable,
    ['exec', 'vite', '--mode', profile.viteMode, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    {
      env: childEnvironment,
      stdio: 'inherit',
    },
  ),
  spawn(pnpmExecutable, ['exec', 'tsx', 'watch', '--tsconfig', 'server/tsconfig.json', 'server/src/index.ts'], {
    env: childEnvironment,
    stdio: 'inherit',
  }),
]

let requestedSignal = null

function stopChildren(signal, excludedChild = null) {
  for (const child of children) {
    if (child !== excludedChild && child.exitCode === null && child.signalCode === null) {
      child.kill(signal)
    }
  }
}

process.once('SIGINT', () => {
  requestedSignal = 'SIGINT'
  stopChildren('SIGINT')
})

process.once('SIGTERM', () => {
  requestedSignal = 'SIGTERM'
  stopChildren('SIGTERM')
})

const childResults = children.map(
  (child) =>
    new Promise((resolve) => {
      child.once('error', (error) => {
        console.error(error)
      })
      child.once('close', (code, signal) => {
        resolve({ child, code, signal })
      })
    }),
)

const firstResult = await Promise.race(childResults)

if (!requestedSignal) {
  stopChildren('SIGTERM', firstResult.child)
}

await Promise.all(childResults)

if (!requestedSignal) {
  process.exitCode = firstResult.code && firstResult.code > 0 ? firstResult.code : 1
}
