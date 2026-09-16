import assert from 'node:assert/strict'
import test from 'node:test'
import { getCurrentUserId, runWithCurrentUser, type CurrentUserIdentity } from './current-user'

function identity(userId: string): CurrentUserIdentity {
  return { userId, email: `${userId}@example.com`, authMode: 'supabase' }
}

test('并发请求在异步等待后仍读取各自的用户身份', async () => {
  const [firstUserId, secondUserId] = await Promise.all([
    runWithCurrentUser(identity('user-a'), async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return getCurrentUserId()
    }),
    runWithCurrentUser(identity('user-b'), async () => {
      await Promise.resolve()
      return getCurrentUserId()
    }),
  ])

  assert.equal(firstUserId, 'user-a')
  assert.equal(secondUserId, 'user-b')
})
