<script setup lang="ts">
import type { ChatItem } from '../types'

defineProps<{
  activeChat: ChatItem | null
}>()
</script>

<template>
  <section class="app-panel p-5">
    <div class="mb-5 flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-highlighted">{{ activeChat?.title ?? '对话' }}</h2>
        <p class="mt-1 text-sm text-muted">围绕当前 JD、简历、匹配分析结果进行自由问答。</p>
      </div>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-pencil" size="sm">重命名</UButton>
    </div>

    <div class="space-y-4">
      <div
        class="max-w-[82%] rounded-2xl border border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_72%,transparent)] p-4"
      >
        <p class="text-sm leading-6 text-highlighted">
          你可以问我：这份 JD 最容易追问什么？我的简历应该先改哪一段？怎么准备 AI Workflow 和 RAG 的回答？
        </p>
      </div>
      <div class="ml-auto max-w-[82%] rounded-2xl border border-primary/30 bg-primary/10 p-4">
        <p class="text-sm leading-6 text-highlighted">帮我围绕当前岗位准备一轮项目面试。</p>
      </div>
    </div>

    <div class="app-panel-muted mt-6 border-dashed p-4 text-sm text-muted">
      真实版本会接入流式对话、会话命名、历史上下文和基于当前 JD/简历的 RAG 检索。
    </div>
  </section>
</template>
