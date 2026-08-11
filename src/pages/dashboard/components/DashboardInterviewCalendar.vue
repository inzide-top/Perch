<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarDate, type DateValue } from '@internationalized/date'
import type { DashboardInterviewScheduleEvent } from '@/types/dashboard'

const props = defineProps<{
  events: DashboardInterviewScheduleEvent[]
}>()

function toCalendarDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function findInitialDate() {
  const firstUpcoming = props.events.find((event) => event.timing === 'upcoming')
  const latestOverdue = [...props.events].reverse().find((event) => event.timing === 'overdue')
  return toCalendarDate(firstUpcoming?.scheduledAt ?? latestOverdue?.scheduledAt ?? new Date())
}

const selectedDate = ref<DateValue>(findInitialDate())
const eventsByDate = computed(() => {
  const groups = new Map<string, DashboardInterviewScheduleEvent[]>()
  for (const event of props.events) {
    const key = toCalendarDate(event.scheduledAt).toString()
    const events = groups.get(key) ?? []
    events.push(event)
    groups.set(key, events)
  }
  return groups
})
const selectedEvents = computed(() => eventsByDate.value.get(selectedDate.value.toString()) ?? [])
const selectedDateLabel = computed(() => {
  const date = new Date(selectedDate.value.year, selectedDate.value.month - 1, selectedDate.value.day)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
})
const upcomingCount = computed(() => props.events.filter((event) => event.timing === 'upcoming').length)
const overdueCount = computed(() => props.events.filter((event) => event.timing === 'overdue').length)

function eventsForDay(day: DateValue) {
  return eventsByDate.value.get(day.toString()) ?? []
}

function formatEventTime(value: string) {
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function eventDotClass(event: DashboardInterviewScheduleEvent) {
  return event.timing === 'overdue' ? 'bg-[#ffa235]' : 'bg-[#8A5EED]'
}
</script>

<template>
  <article class="app-card min-w-0 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="app-section-title">面试日历</h3>
        <p class="mt-1 text-xs leading-5 text-muted">汇总仍待处理的真实面试安排，悬停日期可快速预览。</p>
      </div>
      <div class="flex items-center gap-3 text-[11px] text-muted" aria-label="面试安排统计">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-1.5 rounded-full bg-[#8A5EED]" />待参加 {{ upcomingCount }}
        </span>
        <span v-if="overdueCount" class="inline-flex items-center gap-1.5 text-[#ffa235]">
          <span class="size-1.5 rounded-full bg-[#ffa235]" />已逾期 {{ overdueCount }}
        </span>
      </div>
    </div>

    <div class="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)]">
      <UCalendar
        v-model="selectedDate"
        class="w-full max-w-[20rem] justify-self-center"
        size="sm"
        locale="zh-CN"
        :year-controls="false"
        :fixed-weeks="true"
        :ui="{
          root: 'w-full',
          body: 'w-full',
          grid: 'w-full',
          cellTrigger: 'relative size-9 rounded-lg',
        }"
      >
        <template #day="{ day }">
          <UPopover
            v-if="eventsForDay(day).length"
            mode="hover"
            :open-delay="160"
            :close-delay="100"
            :content="{ side: 'top', sideOffset: 8 }"
            :ui="{ content: 'app-popover-layer' }"
          >
            <span class="relative flex size-9 items-center justify-center">
              <span>{{ day.day }}</span>
              <span class="absolute bottom-1 flex items-center gap-0.5" aria-hidden="true">
                <span
                  v-for="event in eventsForDay(day).slice(0, 3)"
                  :key="event.id"
                  class="size-1 rounded-full"
                  :class="eventDotClass(event)"
                />
              </span>
            </span>
            <template #content>
              <div class="w-72 p-3">
                <p class="text-xs font-semibold text-highlighted">{{ day.month }} 月 {{ day.day }} 日</p>
                <div class="mt-2 space-y-2">
                  <div v-for="event in eventsForDay(day).slice(0, 4)" :key="event.id" class="flex items-start gap-2">
                    <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="eventDotClass(event)" />
                    <div class="min-w-0">
                      <p class="truncate text-xs font-medium text-highlighted">
                        {{ formatEventTime(event.scheduledAt) }} · {{ event.title }}
                      </p>
                      <p class="mt-0.5 truncate text-[11px] text-muted">{{ event.company }} · {{ event.jobTitle }}</p>
                    </div>
                  </div>
                </div>
                <p v-if="eventsForDay(day).length > 4" class="mt-2 text-[11px] text-muted">
                  另有 {{ eventsForDay(day).length - 4 }} 项安排，点击日期查看。
                </p>
              </div>
            </template>
          </UPopover>
          <span v-else class="flex size-9 items-center justify-center">{{ day.day }}</span>
        </template>
      </UCalendar>

      <div class="min-w-0 rounded-2xl bg-[var(--app-surface-muted)] p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-muted">所选日期</p>
            <h4 class="mt-1 text-sm font-semibold text-highlighted">{{ selectedDateLabel }}</h4>
          </div>
          <span class="text-[11px] text-muted">{{ selectedEvents.length }} 项</span>
        </div>

        <div v-if="selectedEvents.length" class="mt-3 space-y-2">
          <RouterLink
            v-for="event in selectedEvents"
            :key="event.id"
            :to="`/opportunities/${event.opportunityId}?section=info`"
            class="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5 outline-none transition-colors hover:border-[var(--app-border-strong)] focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-lg"
              :class="event.timing === 'overdue' ? 'bg-[#ffa235]/12 text-[#ffa235]' : 'bg-[#8A5EED]/12 text-[#8A5EED]'"
            >
              <UIcon
                :name="event.timing === 'overdue' ? 'i-lucide-clock-alert' : 'i-lucide-calendar-clock'"
                class="size-4"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-highlighted">{{ event.title }}</span>
                <span v-if="event.timing === 'overdue'" class="shrink-0 text-[10px] font-medium text-[#ffa235]"
                  >已逾期</span
                >
              </span>
              <span class="mt-0.5 block truncate text-xs text-muted">
                {{ formatEventTime(event.scheduledAt) }} · {{ event.company }} · {{ event.jobTitle }}
              </span>
            </span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
            />
          </RouterLink>
        </div>
        <div v-else class="flex min-h-28 flex-col items-center justify-center px-4 text-center">
          <UIcon name="i-lucide-calendar-check" class="size-5 text-muted" aria-hidden="true" />
          <p class="mt-2 text-xs leading-5 text-muted">
            {{ events.length ? '当天没有面试安排，选择带圆点的日期查看详情。' : '还没有待处理的面试安排。' }}
          </p>
        </div>
      </div>
    </div>
  </article>
</template>
