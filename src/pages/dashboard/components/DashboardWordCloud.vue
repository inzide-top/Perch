<script setup lang="ts">
import * as echarts from 'echarts/core'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'echarts-wordcloud'
import cloudMaskUrl from '@/assets/cloud.svg'
import type { EChartsOption } from 'echarts'
import type { DashboardAbilityInsight } from '@/types/dashboard'

echarts.use([TooltipComponent, CanvasRenderer])

const props = withDefaults(
  defineProps<{
    items: DashboardAbilityInsight[]
    tone?: 'strength' | 'weakness'
  }>(),
  {
    tone: 'strength',
  },
)

const chartElement = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let maskImage: HTMLImageElement | null = null
let resizeObserver: ResizeObserver | null = null

const wordCloudColors = ['#5E83F5', '#79CCF6', '#E2726A', '#ffa235', '#8A5EED', '#fdd845'] as const

function createOption(): EChartsOption {
  return {
    animationDuration: 420,
    animationDurationUpdate: 320,
    tooltip: {
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params
        const data = item && typeof item === 'object' ? (item as { name?: unknown; value?: unknown }) : {}
        const value = typeof data.value === 'number' ? data.value : 0
        return `${typeof data.name === 'string' ? data.name : ''}<br/>提及 ${value} 次`
      },
    },
    series: [
      {
        type: 'wordCloud',
        shape: 'circle',
        maskImage: maskImage ?? undefined,
        keepAspect: true,
        left: 'center',
        top: 'center',
        width: '100%',
        height: '100%',
        sizeRange: [16, 44],
        rotationRange: [-18, 18],
        rotationStep: 18,
        gridSize: 4,
        drawOutOfBound: false,
        shrinkToFit: true,
        layoutAnimation: true,
        textStyle: {
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontWeight: 650,
          color: (params: { dataIndex?: number }) => wordCloudColors[(params.dataIndex ?? 0) % wordCloudColors.length],
        },
        emphasis: {
          focus: 'self',
          textStyle: {
            textShadowBlur: 8,
            textShadowColor: 'rgba(17, 24, 39, 0.18)',
          },
        },
        data: props.items.map((item) => ({
          name: item.label,
          value: Math.max(item.evidenceCount, 1),
        })),
      },
    ],
  }
}

function renderChart() {
  if (!chart) return
  if (!props.items.length) {
    chart.clear()
    return
  }

  if (maskImage && (!maskImage.complete || maskImage.naturalWidth === 0 || maskImage.naturalHeight === 0)) return

  try {
    chart.setOption(createOption(), true)
  } catch {
    // 如果浏览器拒绝 SVG mask，降级为普通圆形词云，不能让组件挂载异常影响外部切换按钮。
    maskImage = null
    chart.clear()
    chart.setOption(createOption(), true)
  }
}

function initChart() {
  if (!chartElement.value || chart) return
  chart = echarts.init(chartElement.value)
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(chartElement.value)

  maskImage = new Image()
  maskImage.onload = renderChart
  maskImage.onerror = () => {
    maskImage = null
    renderChart()
  }
  maskImage.src = cloudMaskUrl
}

watch(
  () => [props.items, props.tone],
  async () => {
    await nextTick()
    renderChart()
  },
  { deep: true },
)

onMounted(() => {
  initChart()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
  maskImage = null
})
</script>

<template>
  <div class="relative h-full min-h-56 w-full overflow-hidden rounded-2xl bg-[var(--app-surface-muted)]">
    <div
      ref="chartElement"
      class="h-full w-full transition-opacity"
      :class="{ 'opacity-0': !items.length }"
      :aria-label="tone === 'strength' ? '优势证据词云' : '待补强证据词云'"
      role="img"
    />
    <div v-if="!items.length" class="absolute inset-0 flex items-center justify-center text-xs text-muted">
      暂时没有可展示的证据
    </div>
  </div>
</template>
