<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { InterviewOverallScore, InterviewSession } from '@/types/interview'
import { getScoreClass } from '@/shared/opportunity/analysisPresentation'

const props = defineProps<{
  score: InterviewOverallScore
  session: InterviewSession
}>()

const emit = defineEmits<{
  'open-reference': [turnId: string]
}>()

type PanelView = 'score' | 'review'

const activeView = ref<PanelView>(props.session.review ? 'review' : 'score')
const displayedScore = ref(props.score.score)
const displayedCoverage = ref(props.score.coverage)
const displayedDimensionScores = ref<Record<string, number | null>>(
  Object.fromEntries(props.score.dimensions.map((item) => [item.key, item.score])),
)
const animationFrames = new Map<string, number>()

const hasReview = computed(() => Boolean(props.session.review))

function getStateLabel(state: InterviewOverallScore['state']) {
  const map = {
    evaluating: '评估中',
    provisional: '暂定评分',
    final: '最终评分',
    partial: '部分评分',
    insufficient: '证据不足',
  } as const

  return map[state]
}

function getScoreTone(score: number | null) {
  return score === null ? '' : getScoreClass(score)
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function cancelNumberAnimation(key: string) {
  const frame = animationFrames.get(key)
  if (frame !== undefined) window.cancelAnimationFrame(frame)
  animationFrames.delete(key)
}

function animateNumber(key: string, from: number, to: number, update: (value: number) => void) {
  cancelNumberAnimation(key)

  if (prefersReducedMotion() || from === to) {
    update(to)
    return
  }

  const startedAt = performance.now()
  const duration = 620

  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    update(Math.round(from + (to - from) * easedProgress))

    if (progress < 1) {
      animationFrames.set(key, window.requestAnimationFrame(step))
    } else {
      animationFrames.delete(key)
    }
  }

  animationFrames.set(key, window.requestAnimationFrame(step))
}

function getPriorityLabel(priority: 'high' | 'medium' | 'low') {
  const map = {
    high: '优先',
    medium: '建议',
    low: '补充',
  } as const

  return map[priority]
}

function getPriorityClass(priority: 'high' | 'medium' | 'low') {
  return `is-${priority}`
}

watch(
  () => props.score.score,
  (score) => {
    if (score === null) {
      cancelNumberAnimation('overall')
      displayedScore.value = null
      return
    }

    animateNumber('overall', displayedScore.value ?? 0, score, (value) => {
      displayedScore.value = value
    })
  },
)

watch(
  () => props.score.coverage,
  (coverage) => {
    animateNumber('coverage', displayedCoverage.value, coverage, (value) => {
      displayedCoverage.value = value
    })
  },
)

watch(
  () => props.score.dimensions.map((item) => ({ ...item })),
  (dimensions) => {
    const activeKeys = new Set(dimensions.map((item) => item.key))

    Object.keys(displayedDimensionScores.value).forEach((key) => {
      if (!activeKeys.has(key)) {
        cancelNumberAnimation(`dimension:${key}`)
        delete displayedDimensionScores.value[key]
      }
    })

    dimensions.forEach((item) => {
      if (item.score === null) {
        cancelNumberAnimation(`dimension:${item.key}`)
        displayedDimensionScores.value[item.key] = null
        return
      }

      animateNumber(`dimension:${item.key}`, displayedDimensionScores.value[item.key] ?? 0, item.score, (value) => {
        displayedDimensionScores.value[item.key] = value
      })
    })
  },
  { deep: true },
)

watch(
  () => props.session.review,
  (review, previousReview) => {
    if (review && !previousReview) activeView.value = 'review'
    if (!review && activeView.value === 'review') activeView.value = 'score'
  },
)

onBeforeUnmount(() => {
  animationFrames.forEach((frame) => window.cancelAnimationFrame(frame))
  animationFrames.clear()
})
</script>

<template>
  <section class="app-panel interview-insights-panel">
    <header class="interview-insights-header">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          {{ activeView === 'review' ? '本轮复盘' : '当前整体表现' }}
        </h2>
        <p class="mt-1 text-xs text-muted">
          {{ activeView === 'review' ? '聚合本轮表现与后续练习方向' : '随有效回答持续更新' }}
        </p>
      </div>
      <UBadge v-if="activeView === 'score'" color="neutral" variant="subtle" :label="getStateLabel(score.state)" />
      <UBadge
        v-else
        :color="session.status === 'completed' ? 'success' : 'warning'"
        variant="subtle"
        :label="session.status === 'completed' ? '已完成' : '提前结束'"
      />
    </header>

    <div v-if="hasReview" class="interview-insights-tabs" role="tablist" aria-label="面试结果视图">
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'score'"
        :class="{ 'is-active': activeView === 'score' }"
        @click="activeView = 'score'"
      >
        整体表现
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'review'"
        :class="{ 'is-active': activeView === 'review' }"
        @click="activeView = 'review'"
      >
        本轮复盘
      </button>
    </div>

    <Transition name="interview-insights-view" mode="out-in">
      <div v-if="activeView === 'score'" key="score" class="interview-insights-body">
        <div class="flex items-end justify-between gap-4">
          <div>
            <strong
              class="interview-score-value text-5xl font-semibold tracking-tight tabular-nums"
              :class="getScoreTone(displayedScore)"
              >{{ displayedScore ?? '--' }}</strong
            >
            <span v-if="displayedScore !== null" class="ml-1 text-sm text-muted">分</span>
          </div>
          <div class="text-right">
            <p class="text-xs text-muted">本轮覆盖度</p>
            <p class="mt-1 text-lg font-semibold text-primary tabular-nums">{{ displayedCoverage }}%</p>
          </div>
        </div>

        <p class="mt-4 text-xs leading-6 text-muted">{{ score.summary }}</p>

        <TransitionGroup name="interview-score-dimension" tag="div" class="mt-5 space-y-3">
          <div v-for="item in score.dimensions" :key="item.key" class="interview-score-dimension">
            <div class="flex items-center justify-between gap-3 text-xs">
              <span class="min-w-0 truncate text-muted" :title="item.label">{{ item.label }}</span>
              <span
                class="interview-score-value shrink-0 font-medium tabular-nums"
                :class="getScoreTone(displayedDimensionScores[item.key] ?? null)"
                >{{ displayedDimensionScores[item.key] ?? '—' }}</span
              >
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
              <div
                class="interview-score-progress h-full rounded-full"
                :class="getScoreTone(displayedDimensionScores[item.key] ?? null)"
                :style="{ width: `${displayedDimensionScores[item.key] ?? 0}%` }"
              />
            </div>
          </div>
        </TransitionGroup>

        <div class="mt-5 border-t border-default pt-4 text-xs leading-5 text-muted">
          <p>
            有效回答 {{ session.answers.filter((item) => item.evaluation).length }} 条 · 已跳过
            {{ session.skips.length }} 题
          </p>
          <p class="mt-1">总体评分只读取本轮能力证据，单回答深度点评不会改写它。</p>
        </div>
      </div>

      <div v-else key="review" class="interview-insights-body">
        <template v-if="session.review">
          <p class="text-sm leading-7 text-muted">{{ session.review.summary }}</p>

          <section v-if="session.review.strengths.length" class="interview-review-section">
            <h3><UIcon name="i-lucide-circle-check" class="text-success" />主要优势</h3>
            <ul>
              <li v-for="item in session.review.strengths" :key="item.title">
                <span class="interview-review-marker is-strength" />
                <div class="min-w-0 flex-1">
                  <div class="interview-review-title-row">
                    <p class="text-sm font-medium text-highlighted">{{ item.title }}</p>
                    <button
                      v-if="item.references.length === 1"
                      type="button"
                      class="interview-review-reference is-single"
                      :aria-label="`查看第 ${item.references[0]!.sequenceNumber} 题的依据`"
                      @click="emit('open-reference', item.references[0]!.turnId)"
                    >
                      第 {{ item.references[0]!.sequenceNumber }} 题
                      <UIcon name="i-lucide-arrow-up-right" class="size-3" />
                    </button>
                  </div>
                  <p v-if="item.detail !== item.title" class="mt-1 text-xs leading-5 text-muted">
                    {{ item.detail }}
                    <span v-if="item.references.length > 1" class="interview-review-inline-references">
                      <button
                        v-for="reference in item.references"
                        :key="reference.turnId"
                        type="button"
                        class="interview-review-reference"
                        :aria-label="`查看第 ${reference.sequenceNumber} 题的依据`"
                        @click="emit('open-reference', reference.turnId)"
                      >
                        {{ reference.sequenceNumber }}
                      </button>
                    </span>
                  </p>
                </div>
              </li>
            </ul>
          </section>

          <section v-if="session.review.gaps.length" class="interview-review-section">
            <h3><UIcon name="i-lucide-target" class="text-warning" />优先练习项</h3>
            <ul>
              <li v-for="item in session.review.gaps" :key="item.title">
                <span class="interview-review-priority" :class="getPriorityClass(item.priority)">
                  {{ getPriorityLabel(item.priority) }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="interview-review-title-row">
                    <p class="text-sm font-medium text-highlighted">{{ item.title }}</p>
                    <button
                      v-if="item.references.length === 1"
                      type="button"
                      class="interview-review-reference is-single"
                      :aria-label="`查看第 ${item.references[0]!.sequenceNumber} 题的依据`"
                      @click="emit('open-reference', item.references[0]!.turnId)"
                    >
                      第 {{ item.references[0]!.sequenceNumber }} 题
                      <UIcon name="i-lucide-arrow-up-right" class="size-3" />
                    </button>
                  </div>
                  <p v-if="item.detail !== item.title" class="mt-1 text-xs leading-5 text-muted">
                    {{ item.detail }}
                    <span v-if="item.references.length > 1" class="interview-review-inline-references">
                      <button
                        v-for="reference in item.references"
                        :key="reference.turnId"
                        type="button"
                        class="interview-review-reference"
                        :aria-label="`查看第 ${reference.sequenceNumber} 题的依据`"
                        @click="emit('open-reference', reference.turnId)"
                      >
                        {{ reference.sequenceNumber }}
                      </button>
                    </span>
                  </p>
                </div>
              </li>
            </ul>
          </section>

          <section v-if="session.review.nextPractice.length" class="interview-review-section">
            <h3><UIcon name="i-lucide-route" class="text-primary" />下一步练习</h3>
            <ol class="interview-review-next-list">
              <li v-for="(item, index) in session.review.nextPractice" :key="item">
                <span>{{ index + 1 }}</span>
                <p>{{ item }}</p>
              </li>
            </ol>
          </section>
        </template>
      </div>
    </Transition>
  </section>
</template>
