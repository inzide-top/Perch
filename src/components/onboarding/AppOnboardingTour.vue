<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { driver, type Driver, type DriveStep, type DriverHook } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { readOnboardingProgress, writeOnboardingProgress, type OnboardingTourStatus } from '@/services/onboarding'

type TourStep = {
  path: string | null
  marker?: string
  title: string
  description: string
}

const emit = defineEmits<{
  'open-mobile-navigation': []
  'close-mobile-navigation': []
}>()

const authStore = useAuthStore()
const chatStore = useChatStore()
const route = useRoute()
const router = useRouter()

const tourSteps: readonly TourStep[] = [
  {
    path: null,
    title: '欢迎来到 PERCH',
    description: '接下来将用 10 步带你熟悉这个 AI 求职工作台。你可以随时关闭引导，刷新页面后会从当前步骤继续。',
  },
  {
    path: null,
    marker: 'settings-navigation',
    title: '第一步：配置 AI API',
    description: '进入设置页配置 AI API。本应用的大多数功能都围绕 AI 实现，这是开始使用前必须完成的一步。',
  },
  {
    path: '/settings',
    marker: 'settings-base-url',
    title: '第二步：输入 API 地址',
    description: '在这里输入你的 AI 服务 API 地址，支持兼容 OpenAI Chat Completions 的服务。',
  },
  {
    path: '/settings',
    marker: 'settings-model-name',
    title: '第三步：输入模型名称',
    description: '填写服务商提供的模型名称，例如 deepseek-chat 或其他可用模型 ID。',
  },
  {
    path: '/settings',
    marker: 'settings-api-key',
    title: '第四步：输入 API Key',
    description: '填写 API Key。它只会保存在当前浏览器，并在发起 AI 请求时临时使用。',
  },
  {
    path: '/settings',
    marker: 'settings-save-model',
    title: '保存模型配置',
    description: '点击这里保存模型配置。保存成功后，就可以正常使用应用中的 AI 功能了。',
  },
  {
    path: '/settings',
    marker: 'settings-save-reusable',
    title: '保存为可复用配置',
    description: '点击这里保存为可复用配置，方便你之后在不同模型之间快速切换。',
  },
  {
    path: '/resumes',
    marker: 'resume-create',
    title: '创建你的第一份简历',
    description: '在这里创建你的简历。简历版本会被保留，后续可以持续编辑和对比。',
  },
  {
    path: '/opportunities',
    marker: 'opportunity-create',
    title: '添加第一条 JD',
    description: '在这里添加你感兴趣的 JD，系统会基于刚刚配置的 AI 模型自动生成匹配结果。',
  },
  {
    path: '/',
    title: '开始使用吧',
    description: '准备好了，开始你的 PERCH 求职工作台之旅吧！',
  },
]

const activeStepIndex = ref<number | null>(null)
const isRunning = ref(false)

let tour: Driver | null = null
let renderToken = 0
let pendingNavigationPath: string | null = null
let startTimer: number | null = null
let resumeTimer: number | null = null
let cancelPendingTargetWait: (() => void) | null = null

const currentUserId = () => authStore.user?.id ?? ''

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 1024
}

function matchesPath(path: string | null) {
  if (!path) return true
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(`${path}/`)
}

function findVisibleTarget(marker: string) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${marker}"]`))
  return (
    elements.find((element) => {
      const rect = element.getBoundingClientRect()
      const styles = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden'
    }) ?? null
  )
}

function waitForVisibleTarget(marker: string, timeout = 8_000) {
  return new Promise<HTMLElement | null>((resolve) => {
    let settled = false
    let interval: number | null = null
    let timeoutId: number | null = null
    let observer: MutationObserver | null = null

    const finish = (target: HTMLElement | null) => {
      if (settled) return
      settled = true
      if (interval !== null) window.clearInterval(interval)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      observer?.disconnect()
      cancelPendingTargetWait = null
      resolve(target)
    }

    const check = () => {
      const target = findVisibleTarget(marker)
      if (target) finish(target)
    }

    cancelPendingTargetWait = () => finish(null)
    observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    interval = window.setInterval(check, 80)
    timeoutId = window.setTimeout(() => finish(findVisibleTarget(marker)), timeout)
    check()
  })
}

function destroyTour() {
  cancelPendingTargetWait?.()
  cancelPendingTargetWait = null
  if (tour?.isActive()) tour.destroy()
  tour = null
}

function setProgress(status: OnboardingTourStatus, step: number) {
  const userId = currentUserId()
  if (userId) writeOnboardingProgress(userId, status, step)
}

function stopTour(status: 'completed' | 'skipped') {
  renderToken += 1
  setProgress(status, activeStepIndex.value ?? 0)
  destroyTour()
  isRunning.value = false
  chatStore.setOpen(true)
  emit('close-mobile-navigation')
}

function pauseTour() {
  renderToken += 1
  destroyTour()
  isRunning.value = false
  chatStore.setOpen(true)
  emit('close-mobile-navigation')
}

const handleCloseClick: DriverHook = () => {
  stopTour('skipped')
}

const handleComplete = () => {
  stopTour('completed')
}

const handleNextClick: DriverHook = () => {
  const index = activeStepIndex.value
  if (index === null) return
  if (index >= tourSteps.length - 1) {
    handleComplete()
    return
  }

  void moveToStep(index + 1)
}

const handlePrevClick: DriverHook = () => {
  const index = activeStepIndex.value
  if (index === null || index <= 0) return
  void moveToStep(index - 1)
}

async function moveToStep(index: number) {
  const userId = currentUserId()
  const step = tourSteps[index]
  if (!userId || !step) return

  const token = ++renderToken
  activeStepIndex.value = index
  setProgress('in_progress', index)
  destroyTour()

  if (index === 1 && isMobileViewport()) {
    emit('open-mobile-navigation')
  } else if (index !== 1) {
    emit('close-mobile-navigation')
  }

  if (step.path && !matchesPath(step.path)) {
    pendingNavigationPath = step.path
    try {
      await router.push({ path: step.path })
    } catch {
      pendingNavigationPath = null
      pauseTour()
      return
    }
    pendingNavigationPath = null
  }

  await nextTick()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  if (token !== renderToken || !isRunning.value) return

  const target = step.marker ? await waitForVisibleTarget(step.marker) : null
  if (token !== renderToken || !isRunning.value) return

  const driveStep: DriveStep = {
    popover: {
      title: step.title,
      description: step.description,
      showProgress: true,
      progressText: `第 ${index + 1} / ${tourSteps.length} 步`,
      nextBtnText: index === tourSteps.length - 1 ? '完成' : index === 0 ? '开始引导' : '下一步',
      doneBtnText: '完成',
      prevBtnText: '上一步',
      disableButtons: index === 0 ? ['previous'] : [],
      onNextClick: handleNextClick,
      onDoneClick: index === tourSteps.length - 1 ? handleComplete : undefined,
      onPrevClick: handlePrevClick,
      onCloseClick: handleCloseClick,
      onPopoverRender: (popover) => {
        popover.closeButton.setAttribute('aria-label', '关闭引导')
      },
    },
  }

  if (target && step.marker) {
    driveStep.element = () => findVisibleTarget(step.marker!) ?? target
  }

  tour = driver({
    steps: [driveStep],
    animate: true,
    duration: 220,
    allowClose: true,
    allowScroll: true,
    overlayColor: '#0f172a',
    overlayOpacity: 0.68,
    stagePadding: 10,
    stageRadius: 14,
    popoverClass: 'perch-onboarding-popover',
    advanceOnClick: index === 1,
  })
  tour.drive()
}

function shouldStartTour() {
  return authStore.isAuthenticated && authStore.mode !== 'interview' && Boolean(currentUserId())
}

function prepareAssistantForTour() {
  if (!shouldStartTour()) return

  const progress = readOnboardingProgress(currentUserId())
  if (progress?.status === 'completed' || progress?.status === 'skipped') return

  chatStore.setOpen(false)
}

function startTour() {
  if (!shouldStartTour() || isRunning.value) return

  const progress = readOnboardingProgress(currentUserId())
  if (progress?.status === 'completed' || progress?.status === 'skipped') return

  const storedStep = progress?.status === 'in_progress' ? progress.step : 0
  const step = Math.min(Math.max(storedStep, 0), tourSteps.length - 1)
  isRunning.value = true
  chatStore.setOpen(false)
  void moveToStep(step)
}

function scheduleResume() {
  if (resumeTimer !== null) window.clearTimeout(resumeTimer)
  resumeTimer = window.setTimeout(() => {
    resumeTimer = null
    if (isRunning.value || !shouldStartTour()) return

    const progress = readOnboardingProgress(currentUserId())
    if (!progress || progress.status !== 'in_progress') return
    const step = Math.min(Math.max(progress.step, 0), tourSteps.length - 1)
    if (!matchesPath(tourSteps[step].path)) return

    isRunning.value = true
    chatStore.setOpen(false)
    void moveToStep(step)
  }, 120)
}

watch(
  () => route.fullPath,
  () => {
    const index = activeStepIndex.value
    if (index === null) return

    const step = tourSteps[index]
    if (isRunning.value && step.path && !matchesPath(step.path) && pendingNavigationPath !== step.path) {
      pauseTour()
      return
    }

    if (!isRunning.value) scheduleResume()
  },
)

watch(
  () => authStore.user?.id,
  (userId, previousUserId) => {
    if (userId && userId !== previousUserId) startTour()
  },
)

onMounted(() => {
  prepareAssistantForTour()
  startTimer = window.setTimeout(() => {
    startTimer = null
    startTour()
  }, 300)
})

onBeforeUnmount(() => {
  renderToken += 1
  if (startTimer !== null) window.clearTimeout(startTimer)
  if (resumeTimer !== null) window.clearTimeout(resumeTimer)
  destroyTour()
})
</script>

<template>
  <span class="sr-only" aria-live="polite">
    {{ isRunning && activeStepIndex !== null ? `正在进行第 ${activeStepIndex + 1} 步引导` : '' }}
  </span>
</template>
