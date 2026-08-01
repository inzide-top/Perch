<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

type FilterOption = {
  label: string
  value: string
}

withDefaults(
  defineProps<{
    label: string
    modelValue: string
    options: FilterOption[]
    allLabel?: string
  }>(),
  { allLabel: '全部' },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const isOpen = ref(false)

function select(value: string) {
  emit('update:modelValue', value)
  isOpen.value = false
}

function closeWhenClickOutside(event: MouseEvent) {
  if (!root.value || root.value.contains(event.target as Node)) return
  isOpen.value = false
}

onMounted(() => document.addEventListener('mousedown', closeWhenClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', closeWhenClickOutside))
</script>

<template>
  <div ref="root" class="relative min-w-40 flex-1">
    <label class="mb-2 block text-xs font-medium text-muted">{{ label }}</label>
    <button
      type="button"
      class="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-default bg-[var(--app-surface)] px-3 text-left text-sm text-highlighted outline-none transition-colors hover:border-accented focus-visible:border-primary"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span>{{ options.find((option) => option.value === modelValue)?.label ?? allLabel }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted" :class="{ 'rotate-180': isOpen }" />
    </button>

    <div
      v-if="isOpen"
      class="app-panel absolute left-0 top-[calc(100%+0.5rem)] z-30 min-w-full overflow-hidden p-1 shadow-xl"
    >
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
        :class="modelValue ? 'text-muted hover:bg-elevated hover:text-highlighted' : 'bg-elevated text-highlighted'"
        @click="select('')"
      >
        {{ allLabel }}
        <UIcon v-if="!modelValue" name="i-lucide-check" class="size-4 text-primary" />
      </button>
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
        :class="
          modelValue === option.value
            ? 'bg-elevated text-highlighted'
            : 'text-muted hover:bg-elevated hover:text-highlighted'
        "
        @click="select(option.value)"
      >
        {{ option.label }}
        <UIcon v-if="modelValue === option.value" name="i-lucide-check" class="size-4 text-primary" />
      </button>
    </div>
  </div>
</template>
