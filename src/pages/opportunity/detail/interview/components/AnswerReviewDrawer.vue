<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { InterviewAnswer, InterviewQuestion } from '@/types/interview'
import { getScoreClass } from '@/shared/opportunity/analysisPresentation'
import { getAiTaskErrorPresentation } from '@/services/ai-errors'

const props = defineProps<{
  open: boolean
  answer: InterviewAnswer | null
  question: InterviewQuestion | null
  loading: boolean
}>()

const emit = defineEmits<{
  close: []
  generate: []
}>()

const isContextExpanded = ref(true)
const isGenerating = computed(() => props.answer?.deepReviewStatus === 'processing')
const failurePresentation = computed(() => getAiTaskErrorPresentation(props.answer?.deepReviewError))

watch(
  () => props.open,
  (open) => {
    if (open) isContextExpanded.value = true
  },
)

function getPointStatusLabel(status: string) {
  return (
    {
      fully_met: '充分覆盖',
      partially_met: '部分覆盖',
      missed: '尚未覆盖',
      incorrect: '存在错误',
      not_assessable: '证据不足',
    }[status] ?? status
  )
}

function getPartStatusLabel(status: string) {
  return (
    {
      answered: '已回答',
      partial: '部分回答',
      missing: '未回答',
      misunderstood: '理解偏差',
    }[status] ?? status
  )
}
</script>

<template>
  <UDrawer
    :open="open"
    direction="right"
    :handle="false"
    :close="false"
    :dismissible="true"
    :ui="{
      overlay: '!z-[170] bg-black/40',
      content:
        '!z-[171] app-drawer isolate h-full w-full max-w-3xl overflow-hidden border-l border-default bg-default shadow-2xl',
    }"
    @update:open="(nextOpen: boolean) => !nextOpen && emit('close')"
  >
    <template #content>
      <section class="flex h-full min-h-0 w-full flex-col bg-default">
        <header class="flex items-start justify-between gap-4 border-b border-default px-5 py-4">
          <div>
            <h2 id="answer-review-drawer-title" class="text-base font-semibold text-highlighted">单回答深度点评</h2>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭深度点评"
            @click="emit('close')"
          />
        </header>

        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain bg-default px-6 py-6">
          <section class="overflow-hidden rounded-2xl border border-default bg-[var(--app-surface-muted)]">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              :aria-expanded="isContextExpanded"
              aria-controls="answer-review-context"
              @click="isContextExpanded = !isContextExpanded"
            >
              <span class="flex min-w-0 items-center gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UIcon name="i-lucide-messages-square" class="size-4" />
                </span>
                <span>
                  <span class="block text-sm font-semibold text-highlighted">本题上下文</span>
                  <span class="mt-0.5 block text-xs text-muted">对照查看问题与原始回答</span>
                </span>
              </span>
              <UIcon
                name="i-lucide-chevron-down"
                class="size-4 shrink-0 text-muted transition-transform duration-200"
                :class="{ 'rotate-180': isContextExpanded }"
              />
            </button>

            <Transition name="answer-review-context">
              <div v-if="isContextExpanded" id="answer-review-context" class="border-t border-default px-5 py-5">
                <div class="grid gap-5 md:grid-cols-2">
                  <article class="min-w-0">
                    <p class="text-xs font-semibold tracking-wide text-muted">对应问题</p>
                    <p class="mt-2 text-sm leading-7 text-highlighted">
                      {{ question?.content ?? '问题内容不可用' }}
                    </p>
                  </article>
                  <article class="min-w-0 border-default md:border-l md:pl-5">
                    <p class="text-xs font-semibold tracking-wide text-muted">你的回答</p>
                    <p class="mt-2 whitespace-pre-line text-sm leading-7 text-highlighted">
                      {{ answer?.content ?? '回答内容不可用' }}
                    </p>
                  </article>
                </div>
              </div>
            </Transition>
          </section>

          <section
            v-if="!answer?.deepReview"
            class="flex min-h-60 flex-col items-center justify-center rounded-2xl border px-6 text-center"
            :class="
              loading || answer?.deepReviewStatus === 'processing'
                ? 'border-dashed border-primary/35 bg-primary/5'
                : 'border-dashed border-default bg-[var(--app-surface-muted)]'
            "
          >
            <template v-if="loading || answer?.deepReviewStatus === 'processing'">
              <div class="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
              </div>
              <p class="mt-4 text-base font-semibold text-highlighted">
                {{ isGenerating ? '正在生成深度点评' : '正在加载深度点评' }}
              </p>
              <p class="mt-2 max-w-md text-sm leading-6 text-muted">
                {{
                  isGenerating
                    ? '正在对照本题评估点，分析回答覆盖度、证据和改进空间。你可以先关闭抽屉，任务会继续执行。'
                    : '点评已经生成，正在加载完整内容，请稍候。'
                }}
              </p>
            </template>
            <template v-else>
              <div
                class="flex size-10 items-center justify-center rounded-2xl"
                :class="
                  answer?.deepReviewStatus === 'failed' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'
                "
              >
                <UIcon
                  :name="answer?.deepReviewStatus === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-scan-search'"
                  class="size-5"
                />
              </div>
              <p class="mt-3 text-sm font-medium text-highlighted">
                {{ answer?.deepReviewStatus === 'failed' ? failurePresentation.title : '还没有生成深度点评' }}
              </p>
              <p class="mt-2 max-w-md text-xs leading-5 text-muted">
                {{
                  answer?.deepReviewStatus === 'failed'
                    ? failurePresentation.description
                    : '点评会重点分析这次回答的覆盖度、证据、表达和可以继续追问的部分。'
                }}
              </p>
              <UButton
                type="button"
                class="mt-4"
                icon="i-lucide-sparkles"
                :disabled="!answer"
                @click="emit('generate')"
                >{{ answer?.deepReviewStatus === 'failed' ? '重新生成' : '生成深度点评' }}</UButton
              >
            </template>
          </section>

          <section v-else class="space-y-6">
            <section
              class="rounded-2xl border border-primary/25 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--app-accent-soft)_78%,var(--app-surface)),var(--app-surface))] p-5"
            >
              <div class="flex items-start justify-between gap-5">
                <div class="flex min-w-0 items-start gap-3">
                  <span
                    class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"
                  >
                    <UIcon name="i-lucide-scan-search" class="size-4.5" />
                  </span>
                  <div>
                    <p class="text-base font-semibold text-highlighted">点评结论</p>
                    <p class="mt-1 text-xs text-muted">只针对当前回答，不改写右侧总体评分</p>
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <span
                    class="interview-score-value text-4xl font-semibold tracking-tight tabular-nums"
                    :class="getScoreClass(answer.deepReview.score.contentScore)"
                    >{{ answer.deepReview.score.contentScore }}</span
                  >
                  <span class="ml-1 text-xs text-muted">分</span>
                </div>
              </div>
              <p class="mt-5 border-t border-primary/15 pt-4 text-[15px] leading-7 text-muted">
                {{ answer.deepReview.summary }}
              </p>
            </section>

            <div
              v-if="answer.deepReview.score.assistanceFactor < 1"
              class="flex items-center justify-between rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm"
            >
              <span class="text-muted">本题使用了提示，计入总体证据时会降低可信权重</span>
              <span class="font-semibold text-warning">计入分 {{ answer.deepReview.score.creditedScore }}</span>
            </div>

            <section v-if="answer.deepReview.questionPartEvaluations.length > 1" class="app-panel-muted p-5">
              <p class="text-base font-semibold text-highlighted">复合问题覆盖情况</p>
              <ul class="mt-3 space-y-2">
                <li
                  v-for="(part, index) in answer.deepReview.questionPartEvaluations"
                  :key="part.partKey"
                  class="flex items-start justify-between gap-4 text-sm leading-6"
                >
                  <span class="text-muted">第 {{ index + 1 }} 部分 · {{ part.analysis }}</span>
                  <span class="shrink-0 font-medium text-highlighted">{{ getPartStatusLabel(part.status) }}</span>
                </li>
              </ul>
            </section>

            <section class="space-y-4">
              <div>
                <h3 class="text-base font-semibold text-highlighted">评估点分析</h3>
                <p class="mt-1 text-sm text-muted">按本题预设的能力证据逐项对照。</p>
              </div>
              <article
                v-for="point in answer.deepReview.pointEvaluations"
                :key="point.pointKey"
                class="rounded-2xl border border-default bg-[var(--app-surface-muted)] p-5"
              >
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-[15px] font-semibold text-highlighted">{{ point.label }}</p>
                    <p class="mt-1 text-xs text-muted">
                      权重 {{ point.relativeWeight }}% · {{ getPointStatusLabel(point.status) }}
                    </p>
                  </div>
                  <span
                    class="interview-score-value text-2xl font-semibold tabular-nums"
                    :class="getScoreClass(point.score)"
                    >{{ point.score }}</span
                  >
                </div>
                <p class="mt-4 text-sm leading-7 text-muted">{{ point.analysis }}</p>
                <blockquote
                  v-if="point.evidenceExcerpt"
                  class="mt-4 rounded-xl border-l-2 border-primary/40 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted"
                >
                  “{{ point.evidenceExcerpt }}”
                </blockquote>
                <p class="mt-4 text-sm leading-6 text-highlighted">
                  <span class="text-muted">改进：</span>{{ point.improvement }}
                </p>
              </article>
            </section>

            <div class="grid gap-3 sm:grid-cols-2">
              <section class="app-panel-muted p-5">
                <p class="text-base font-semibold text-highlighted">表现较好的部分</p>
                <ul class="mt-3 space-y-3 text-sm leading-6 text-muted">
                  <li v-for="item in answer.deepReview.strengths" :key="item.title" class="flex gap-2">
                    <UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-success" />
                    <span
                      ><strong class="font-medium text-highlighted">{{ item.title }}</strong> ·
                      {{ item.analysis }}</span
                    >
                  </li>
                </ul>
              </section>
              <section class="app-panel-muted p-5">
                <p class="text-base font-semibold text-highlighted">下一次如何改进</p>
                <ul class="mt-3 space-y-3 text-sm leading-6 text-muted">
                  <li v-for="item in answer.deepReview.improvements" :key="item.title" class="flex gap-2">
                    <UIcon name="i-lucide-arrow-up-right" class="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span
                      ><strong class="font-medium text-highlighted">{{ item.title }}</strong> · {{ item.action }}</span
                    >
                  </li>
                </ul>
              </section>
            </div>

            <section class="app-panel-muted p-5">
              <p class="text-base font-semibold text-highlighted">表达表现</p>
              <p class="mt-2 text-sm leading-7 text-muted">{{ answer.deepReview.communication.analysis }}</p>
            </section>

            <section class="app-panel-muted p-5">
              <template v-if="answer.deepReview.answerRevision.mode === 'revision'">
                <p class="text-base font-semibold text-highlighted">基于原回答的优化版本</p>
                <p class="mt-3 whitespace-pre-line text-sm leading-7 text-muted">
                  {{ answer.deepReview.answerRevision.revisedAnswer }}
                </p>
              </template>
              <template v-else>
                <p class="text-base font-semibold text-highlighted">建议先补充知识框架</p>
                <p class="mt-2 text-sm leading-7 text-muted">{{ answer.deepReview.answerRevision.reason }}</p>
                <ol class="mt-3 list-decimal space-y-2 pl-4 text-sm leading-6 text-muted">
                  <li v-for="item in answer.deepReview.answerRevision.learningOutline" :key="item">{{ item }}</li>
                </ol>
              </template>
            </section>
          </section>
        </div>
      </section>
    </template>
  </UDrawer>
</template>

<style scoped>
.answer-review-context-enter-active,
.answer-review-context-leave-active {
  overflow: hidden;
  transition:
    max-height 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 160ms ease;
}

.answer-review-context-enter-from,
.answer-review-context-leave-to {
  max-height: 0;
  opacity: 0;
}

.answer-review-context-enter-to,
.answer-review-context-leave-from {
  max-height: 48rem;
  opacity: 1;
}
</style>
