<script setup lang="ts">
import type { VersionDiffItem } from '@/types/resume'

defineProps<{
  items: VersionDiffItem[]
}>()

function formatDiffValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '空'
  if (typeof value === 'string') return value

  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <div class="space-y-3">
    <article v-for="item in items" :key="item.field" class="app-card p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <p class="text-sm font-medium text-highlighted">{{ item.label }}</p>
      </div>

      <div class="version-diff-text rounded-xl border border-default bg-(--app-surface) px-3 py-2 text-sm leading-6">
        <template v-if="item.textSegments?.length">
          <span
            v-for="(segment, index) in item.textSegments"
            :key="`${item.field}-${index}`"
            :class="{
              'version-diff-segment-added': segment.added,
              'version-diff-segment-removed': segment.removed,
            }"
          >
            {{ segment.value }}
          </span>
        </template>

        <template v-else-if="item.before === null">
          <span class="version-diff-segment-added">{{ formatDiffValue(item.after) }}</span>
        </template>

        <template v-else-if="item.after === null">
          <span class="version-diff-segment-removed">{{ formatDiffValue(item.before) }}</span>
        </template>

        <template v-else>
          {{ formatDiffValue(item.after) }}
        </template>
      </div>
    </article>
  </div>
</template>
