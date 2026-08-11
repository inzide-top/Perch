type BackgroundTaskVersion = {
  status: string
  updatedAt: string | null
}

/** 同一后台任务只有状态或服务端更新时间变化时，才需要触发业务 Store 刷新。 */
export function isSameBackgroundTaskVersion(current: BackgroundTaskVersion, next: BackgroundTaskVersion) {
  return current.status === next.status && current.updatedAt === next.updatedAt
}
