const storagePrefix = 'agent-seek-employment:'
const legacyStoragePrefixes = ['perch:']
const activeUserStorageKey = `${storagePrefix}active-user`
const deviceStorageKeys = new Set([`${storagePrefix}sidebar-expanded`])

function clearStorage(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => typeof key === 'string',
  )

  for (const key of keys) {
    const isAppOwnedKey =
      key.startsWith(storagePrefix) || legacyStoragePrefixes.some((prefix) => key.startsWith(prefix))
    if (isAppOwnedKey && !deviceStorageKeys.has(key)) storage.removeItem(key)
  }
}

export function prepareBrowserStateForUser(userId: string) {
  if (typeof localStorage === 'undefined') return

  const previousUserId = localStorage.getItem(activeUserStorageKey)
  if (previousUserId && previousUserId !== userId) {
    clearStorage(localStorage)
    if (typeof sessionStorage !== 'undefined') clearStorage(sessionStorage)
  }

  localStorage.setItem(activeUserStorageKey, userId)
}

export function clearAuthenticatedBrowserState() {
  if (typeof localStorage !== 'undefined') clearStorage(localStorage)
  if (typeof sessionStorage !== 'undefined') clearStorage(sessionStorage)
}
