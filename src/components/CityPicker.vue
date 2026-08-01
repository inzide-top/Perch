<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { chinaCities } from '@/data/chinaCities'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    max?: number
    panelHeightClass?: string
  }>(),
  {
    max: 5,
    panelHeightClass: 'h-80',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const isOpen = ref(false)
const keyword = ref('')
const activeProvince = ref(chinaCities[0].name)
const pickerRef = ref<HTMLElement | null>(null)

const selectedCities = computed(() => props.modelValue ?? [])
const activeCities = computed(() => {
  return chinaCities.find((province) => province.name === activeProvince.value)?.cities ?? []
})
const filteredCities = computed(() => {
  const trimmedKeyword = keyword.value.trim()
  if (!trimmedKeyword) return activeCities.value

  return Array.from(new Set(chinaCities.flatMap((province) => province.cities))).filter((city) =>
    city.includes(trimmedKeyword),
  )
})
const isMaxSelected = computed(() => selectedCities.value.length >= props.max)

function toggleCity(city: string) {
  const nextCities = [...selectedCities.value]
  const cityIndex = nextCities.indexOf(city)

  if (cityIndex >= 0) {
    nextCities.splice(cityIndex, 1)
    emit('update:modelValue', nextCities)
    return
  }

  if (isMaxSelected.value) return

  nextCities.push(city)
  emit('update:modelValue', nextCities)
}

function removeCity(city: string) {
  emit(
    'update:modelValue',
    selectedCities.value.filter((item) => item !== city),
  )
}

function selectProvince(provinceName: string) {
  activeProvince.value = provinceName
  keyword.value = ''
}

function closePickerWhenClickOutside(event: MouseEvent) {
  if (!pickerRef.value || pickerRef.value.contains(event.target as Node)) return

  isOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', closePickerWhenClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closePickerWhenClickOutside)
})
</script>

<template>
  <div ref="pickerRef" class="relative">
    <div
      class="city-picker-trigger flex h-10 min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-default bg-[var(--app-surface)] px-3 py-0 text-left text-sm transition-colors hover:border-accented focus-within:border-primary"
      role="button"
      tabindex="0"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
      @keydown.enter.prevent="isOpen = !isOpen"
      @keydown.space.prevent="isOpen = !isOpen"
    >
      <div class="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-hidden">
        <button
          v-for="city in selectedCities"
          :key="city"
          type="button"
          class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md border border-default bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)] px-1.5 text-[11px] leading-none text-highlighted"
          @click.stop="removeCity(city)"
        >
          {{ city }}
          <UIcon name="i-lucide-x" class="size-2.5 text-muted" />
        </button>
        <span v-if="!selectedCities.length" class="text-dimmed">请选择城市</span>
      </div>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 shrink-0 text-muted transition-transform"
        :class="{ 'rotate-180': isOpen }"
      />
    </div>

    <div
      v-if="isOpen"
      class="app-panel absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden shadow-xl"
      @mousedown.stop
      @click.stop
      @wheel.stop
    >
      <div class="border-b border-default p-3">
        <UInput v-model="keyword" icon="i-lucide-search" class="w-full" placeholder="搜索城市，例如：杭州" />
        <p class="mt-2 text-xs text-muted">最多选择 {{ max }} 个城市</p>
      </div>

      <div class="grid grid-cols-[8rem_minmax(0,1fr)]" :class="panelHeightClass">
        <div
          class="min-h-0 overflow-y-auto border-r border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_72%,transparent)] p-2"
          @wheel.stop
        >
          <button
            v-for="province in chinaCities"
            :key="province.name"
            type="button"
            class="w-full rounded-md px-3 py-2 text-left text-sm transition-colors"
            :class="
              activeProvince === province.name
                ? 'bg-default text-highlighted'
                : 'text-muted hover:bg-default hover:text-highlighted'
            "
            @click="selectProvince(province.name)"
          >
            {{ province.name }}
          </button>
        </div>

        <div class="min-h-0 overflow-y-auto p-3" @wheel.stop>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              v-for="city in filteredCities"
              :key="city"
              type="button"
              class="rounded-md border px-3 py-2 text-sm transition-colors"
              :class="
                selectedCities.includes(city)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-default text-muted hover:border-accented hover:bg-elevated hover:text-highlighted'
              "
              :disabled="!selectedCities.includes(city) && isMaxSelected"
              @click="toggleCity(city)"
            >
              {{ city }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
