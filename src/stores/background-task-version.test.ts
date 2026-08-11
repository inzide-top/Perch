import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameBackgroundTaskVersion } from './background-task-version'

test('状态和更新时间都相同代表后台任务没有新版本', () => {
  assert.equal(
    isSameBackgroundTaskVersion(
      { status: 'processing', updatedAt: '2026-08-10T10:00:00.000Z' },
      { status: 'processing', updatedAt: '2026-08-10T10:00:00.000Z' },
    ),
    true,
  )
})

test('状态或更新时间变化代表后台任务需要刷新', () => {
  assert.equal(
    isSameBackgroundTaskVersion(
      { status: 'processing', updatedAt: '2026-08-10T10:00:00.000Z' },
      { status: 'completed', updatedAt: '2026-08-10T10:00:05.000Z' },
    ),
    false,
  )
  assert.equal(
    isSameBackgroundTaskVersion(
      { status: 'processing', updatedAt: '2026-08-10T10:00:00.000Z' },
      { status: 'processing', updatedAt: '2026-08-10T10:00:05.000Z' },
    ),
    false,
  )
})
