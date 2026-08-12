<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNearViewport } from '@/composables/useNearViewport'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'

type RingSegment = {
  key: string
  label: string
  count: number
  color: string
}

const props = withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    total: number
    segments: RingSegment[]
    emptyLabel?: string
  }>(),
  {
    subtitle: '',
    emptyLabel: '暂无数据',
  },
)

const chartElement = ref<HTMLDivElement | null>(null)
const visibilityTarget = ref<HTMLElement | null>(null)
const { isNearViewport } = useNearViewport(visibilityTarget)
const isChartRuntimeLoading = ref(false)
const isChartReady = ref(false)
let chart: EChartsType | null = null
let echartsCore: typeof import('echarts/core') | null = null
let resizeObserver: ResizeObserver | null = null
let disposed = false

const hasData = () => props.total > 0 && props.segments.some((segment) => segment.count > 0)

function getBorderColor() {
  if (typeof window === 'undefined') return '#BFBFBF'

  return getComputedStyle(document.documentElement).getPropertyValue('--app-border').trim() || '#BFBFBF'
}

function getSurfaceColor() {
  if (typeof window === 'undefined') return '#ffffff'

  return getComputedStyle(document.documentElement).getPropertyValue('--app-surface').trim() || '#ffffff'
}

function createOption(): EChartsOption {
  const visibleSegments = props.segments.filter((segment) => segment.count > 0)
  const data = hasData()
    ? visibleSegments.map((segment) => ({
        name: segment.label,
        value: segment.count,
        itemStyle: { color: segment.color },
      }))
    : [{ name: props.emptyLabel, value: 1, itemStyle: { color: getBorderColor() } }]

  return {
    animationDuration: 420,
    animationDurationUpdate: 320,
    tooltip: hasData()
      ? {
          trigger: 'item',
          formatter: (params: unknown) => {
            const item = (Array.isArray(params) ? params[0] : params) as {
              name?: unknown
              value?: unknown
              percent?: unknown
            }
            const name = typeof item?.name === 'string' ? item.name : ''
            const value = typeof item?.value === 'number' ? item.value : 0
            const percent = typeof item?.percent === 'number' ? item.percent : 0
            return `${name}<br/>${value} 条（${percent}%）`
          },
        }
      : undefined,
    series: [
      {
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '50%'],
        silent: !hasData(),
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: getSurfaceColor(),
          borderWidth: 2,
        },
        data,
      },
    ],
  }
}

function renderChart() {
  if (!chart) return
  chart.setOption(createOption(), true)
}

async function initChart() {
  if (!chartElement.value || chart || isChartRuntimeLoading.value || !isNearViewport.value) return

  isChartRuntimeLoading.value = true
  const [core, components, charts, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/components'),
    import('echarts/charts'),
    import('echarts/renderers'),
  ])
  if (disposed || !chartElement.value) return

  core.use([components.TooltipComponent, charts.PieChart, renderers.CanvasRenderer])
  echartsCore = core
  chart = echartsCore.init(chartElement.value)
  isChartReady.value = true
  isChartRuntimeLoading.value = false

  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(chartElement.value)
  renderChart()
}

watch(
  () => [props.total, props.segments, props.emptyLabel],
  async () => {
    await nextTick()
    renderChart()
  },
  { deep: true },
)

onMounted(() => {
  if (isNearViewport.value) void initChart()
})

watch(isNearViewport, (isVisible) => {
  if (isVisible) void initChart()
})

onBeforeUnmount(() => {
  disposed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <article ref="visibilityTarget" class="app-card flex min-h-[244px] min-w-0 flex-col p-5">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h3 class="app-section-title truncate">{{ title }}</h3>
        <p v-if="subtitle" class="mt-1 text-xs leading-5 text-[var(--app-neutral)]">{{ subtitle }}</p>
      </div>
      <span class="app-soft-badge shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium">概览</span>
    </div>

    <div class="mt-5 flex min-h-32 flex-1 items-center gap-5">
      <div
        class="relative flex size-32 shrink-0 items-center justify-center"
        role="img"
        :aria-label="`${title}，共 ${total} 条`"
      >
        <div ref="chartElement" class="absolute inset-0" aria-hidden="true" />
        <USkeleton v-if="!isChartReady" class="absolute inset-2 rounded-full" />
        <div class="relative z-10 flex flex-col items-center justify-center text-center">
          <span class="text-2xl font-semibold tracking-tight text-highlighted">{{ total }}</span>
          <span class="text-[11px] text-[var(--app-neutral)]">{{ hasData() ? '条记录' : emptyLabel }}</span>
        </div>
      </div>

      <div class="flex min-h-32 min-w-0 flex-1 flex-col justify-center space-y-2.5">
        <div v-for="segment in segments" :key="segment.key" class="flex items-center justify-between gap-3 text-xs">
          <span class="flex min-w-0 items-center gap-2 text-[#696969]">
            <span class="size-2 shrink-0 rounded-full" :style="{ background: segment.color }" aria-hidden="true" />
            <span class="truncate">{{ segment.label }}</span>
          </span>
          <span class="shrink-0 font-semibold text-highlighted">{{ segment.count }}</span>
        </div>
      </div>
    </div>
  </article>
</template>
