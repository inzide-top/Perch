import { onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

type DelayedLoadingOptions = {
  delay?: number
  minVisibleDuration?: number
}

/**
 * 避免极快请求让骨架屏闪现；一旦展示，至少保持一小段时间以稳定布局。
 */
export function useDelayedLoading(
  source: MaybeRefOrGetter<boolean>,
  { delay = 200, minVisibleDuration = 300 }: DelayedLoadingOptions = {},
) {
  const isVisible = ref(false)
  let delayTimer: number | undefined
  let hideTimer: number | undefined
  let shownAt = 0

  function clearTimers() {
    if (delayTimer) window.clearTimeout(delayTimer)
    if (hideTimer) window.clearTimeout(hideTimer)
    delayTimer = undefined
    hideTimer = undefined
  }

  watch(
    () => toValue(source),
    (isLoading) => {
      clearTimers()

      if (isLoading) {
        if (isVisible.value) return

        delayTimer = window.setTimeout(() => {
          isVisible.value = true
          shownAt = Date.now()
          delayTimer = undefined
        }, delay)
        return
      }

      if (!isVisible.value) return

      const remainingDuration = Math.max(0, minVisibleDuration - (Date.now() - shownAt))
      hideTimer = window.setTimeout(() => {
        isVisible.value = false
        hideTimer = undefined
      }, remainingDuration)
    },
    { immediate: true },
  )

  onBeforeUnmount(clearTimers)

  return isVisible
}
