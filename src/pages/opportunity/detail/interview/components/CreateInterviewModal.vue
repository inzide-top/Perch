<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { InterviewConfig, InterviewDifficulty, InterviewScale, InterviewType } from '@/types/interview'

const props = defineProps<{
  open: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [config: InterviewConfig]
}>()

const typeOptions: Array<{ label: string; value: InterviewType; description: string }> = [
  { label: '基础面', value: 'foundation', description: '围绕岗位基础能力、工程方法和通用问题解决能力展开。' },
  { label: '项目面', value: 'project', description: '围绕真实项目、个人职责、方案取舍和业务迁移能力展开。' },
]
const scaleOptions: Array<{ label: string; value: InterviewScale; description: string }> = [
  { label: '快速', value: 'quick', description: '适合碎片化练习，覆盖少量核心主题。' },
  { label: '标准', value: 'standard', description: '平衡覆盖度与深挖程度，推荐日常训练使用。' },
  { label: '深度', value: 'deep', description: '覆盖更多主题，并保留更多追问空间。' },
]
const difficultyOptions: Array<{ label: string; value: InterviewDifficulty; description: string }> = [
  { label: '基础', value: 'basic', description: '考察概念理解、标准流程和基础应用。' },
  { label: '标准', value: 'standard', description: '考察常见场景、分析过程和经验迁移。' },
  { label: '进阶', value: 'advanced', description: '考察复杂约束、取舍和不确定场景。' },
  { label: '自适应', value: 'adaptive', description: '根据连续回答逐步调整难度，不会单题剧烈波动。' },
]

const config = reactive<InterviewConfig>({
  type: 'foundation',
  scale: 'standard',
  difficulty: 'adaptive',
  referenceHistoricalWeaknesses: true,
})

function resetForm() {
  Object.assign(config, {
    type: 'foundation',
    scale: 'standard',
    difficulty: 'adaptive',
    referenceHistoricalWeaknesses: true,
  })
}

function close() {
  if (props.loading) return
  emit('close')
}

function submit() {
  if (props.loading) return
  emit('submit', { ...config })
}

watch(
  () => props.open,
  (open, wasOpen) => {
    if (!open && wasOpen) resetForm()
  },
)
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!loading"
    :close="false"
    :ui="{
      overlay: 'bg-black/55 backdrop-blur-[2px]',
      content: 'app-panel interview-create-modal w-[calc(100%-2rem)] max-w-2xl overflow-hidden shadow-2xl',
    }"
    @update:open="(nextOpen: boolean) => !nextOpen && close()"
  >
    <template #content>
      <section class="flex max-h-[calc(100vh-5rem)] w-full flex-col">
        <header class="shrink-0 flex items-start justify-between gap-4 border-b border-default px-6 py-5">
          <div>
            <h2 id="create-interview-dialog-title" class="text-lg font-semibold tracking-tight text-highlighted">
              新建模拟面试
            </h2>
            <p class="mt-1 text-sm leading-6 text-muted">开始后本轮类型、规模和难度会被冻结，保证复盘结果可追溯。</p>
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="关闭新建模拟面试"
            :disabled="loading"
            @click="close"
          />
        </header>

        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <div class="mb-3 flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-medium text-highlighted">面试类型</h3>
              <span class="text-xs text-muted">决定本轮提问上下文</span>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <button
                v-for="item in typeOptions"
                :key="item.value"
                type="button"
                class="interview-config-option text-left"
                :class="{ 'is-selected': config.type === item.value }"
                :disabled="loading"
                @click="config.type = item.value"
              >
                <span class="flex items-center justify-between gap-3">
                  <span class="text-sm font-medium text-highlighted">{{ item.label }}</span>
                  <UIcon v-if="config.type === item.value" name="i-lucide-check" class="size-4 text-primary" />
                </span>
                <span class="mt-1.5 block text-xs leading-5 text-muted">{{ item.description }}</span>
              </button>
            </div>
          </section>

          <section>
            <div class="mb-3 flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-medium text-highlighted">面试规模</h3>
              <span class="text-xs text-muted">系统控制主题与总问题额度</span>
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <button
                v-for="item in scaleOptions"
                :key="item.value"
                type="button"
                class="interview-config-option text-left"
                :class="{ 'is-selected': config.scale === item.value }"
                :disabled="loading"
                @click="config.scale = item.value"
              >
                <span class="text-sm font-medium text-highlighted">{{ item.label }}</span>
                <span class="mt-1.5 block text-xs leading-5 text-muted">{{ item.description }}</span>
              </button>
            </div>
          </section>

          <section>
            <div class="mb-3 flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-medium text-highlighted">难度</h3>
              <span class="text-xs text-muted">影响问题的抽象层级与追问方向</span>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <button
                v-for="item in difficultyOptions"
                :key="item.value"
                type="button"
                class="interview-config-option text-left"
                :class="{ 'is-selected': config.difficulty === item.value }"
                :disabled="loading"
                @click="config.difficulty = item.value"
              >
                <span class="text-sm font-medium text-highlighted">{{ item.label }}</span>
                <span class="mt-1.5 block text-xs leading-5 text-muted">{{ item.description }}</span>
              </button>
            </div>
          </section>

          <label class="interview-config-toggle">
            <span>
              <span class="block text-sm font-medium text-highlighted">参考历史薄弱项</span>
              <span class="mt-1 block text-xs leading-5 text-muted"
                >优先覆盖近期反复暴露、且尚未充分验证的能力项。</span
              >
            </span>
            <input v-model="config.referenceHistoricalWeaknesses" type="checkbox" :disabled="loading" />
            <span class="interview-switch" aria-hidden="true"><span /></span>
          </label>
        </div>

        <footer class="shrink-0 flex items-center justify-end gap-2 border-t border-default px-6 py-4">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="close">取消</UButton>
          <UButton
            type="button"
            icon="i-lucide-play"
            class="app-primary-button"
            :loading="loading"
            :disabled="loading"
            @click="submit"
          >
            开始面试
          </UButton>
        </footer>
      </section>
    </template>
  </UModal>
</template>
