import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useNearViewport(target: Ref<HTMLElement | null>, rootMargin = '180px') {
  const isNearViewport = ref(false)
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (!target.value || typeof IntersectionObserver === 'undefined') {
      isNearViewport.value = true
      return
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        isNearViewport.value = true
        observer?.disconnect()
        observer = null
      },
      { rootMargin },
    )
    observer.observe(target.value)
  })

  onBeforeUnmount(() => observer?.disconnect())

  return { isNearViewport }
}
