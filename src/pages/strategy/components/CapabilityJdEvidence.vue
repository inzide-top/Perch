<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDateOnly } from '@/shared/formatDate'
import type { CapabilityJdTheme, CapabilityProfile } from '@/types/capability'

const props = defineProps<{ profile: CapabilityProfile }>()

const isRawEvidenceExpanded = ref(false)
const expandedThemeKeys = ref<string[]>([])
const hasThemes = computed(
  () => props.profile.jdOverview.strengthThemes.length > 0 || props.profile.jdOverview.gapThemes.length > 0,
)

function toggleTheme(themeKey: string) {
  expandedThemeKeys.value = expandedThemeKeys.value.includes(themeKey)
    ? expandedThemeKeys.value.filter((key) => key !== themeKey)
    : [...expandedThemeKeys.value, themeKey]
}

function visibleSources(theme: CapabilityJdTheme) {
  return expandedThemeKeys.value.includes(theme.themeKey) ? theme.sources : theme.sources.slice(0, 3)
}

function getStatusLabel(status: CapabilityProfile['jdSignals'][number]['opportunityStatus']) {
  return {
    pending_apply: '待投递',
    applied: '已投递',
    written_test: '笔试中',
    interviewing: '面试中',
    oc: 'OC',
    offered: '已 Offer',
    closed: '已终止',
  }[status]
}

function getRecommendationLabel(recommendation: CapabilityProfile['jdSignals'][number]['recommendation']) {
  return {
    strong_match: '强匹配',
    worth_trying: '值得投递',
    risky: '谨慎投递',
    not_recommended: '不建议',
  }[recommendation]
}

function getRecommendationClass(recommendation: CapabilityProfile['jdSignals'][number]['recommendation']) {
  return {
    strong_match:
      'border border-[color-mix(in_srgb,#8A5EED_35%,var(--app-border))] bg-[color-mix(in_srgb,#8A5EED_12%,transparent)] text-[#8A5EED]',
    worth_trying:
      'border border-[color-mix(in_srgb,var(--app-success)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-success)_12%,transparent)] text-[var(--app-success)]',
    risky:
      'border border-[color-mix(in_srgb,var(--app-warning)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-warning)_12%,transparent)] text-[var(--app-warning)]',
    not_recommended:
      'border border-[color-mix(in_srgb,var(--app-neutral)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-neutral)_12%,transparent)] text-[var(--app-text-muted)]',
  }[recommendation]
}

function scoreClass(score: number) {
  if (score >= 90) return 'bg-[linear-gradient(100deg,#6366f1,#dd45a4)] bg-clip-text text-transparent'
  if (score >= 60) return 'text-[var(--app-success)]'
  if (score >= 30) return 'text-[var(--app-warning)]'
  return 'text-[var(--app-neutral)]'
}

function ratioLabel(theme: CapabilityJdTheme) {
  return Math.round(theme.frequencyRatio * 100)
}
</script>

<template>
  <article class="app-card min-w-0 p-5 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="app-section-kicker">JD evidence</p>
        <h2 class="mt-1 text-base font-semibold text-highlighted">JD 共性画像</h2>
        <p class="mt-1 max-w-2xl text-xs leading-5 text-muted">
          将不同岗位中语义相近的优势和待补强项合并统计；次数按岗位去重，结论仍可追溯到原始分析。
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="profile.jdOverview.indexingStatus !== 'ready'"
          class="app-soft-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-muted"
          role="status"
        >
          <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
          已聚合 {{ profile.jdOverview.indexedOpportunityCount }}/{{ profile.jdOverview.analyzedOpportunityCount }}
          个岗位
        </span>
        <span
          v-if="profile.sourceCounts.failedJdAnalyses"
          class="app-soft-badge rounded-full px-2.5 py-1 text-[11px] text-muted"
        >
          {{ profile.sourceCounts.failedJdAnalyses }} 条分析失败，不纳入结论
        </span>
      </div>
    </div>

    <div v-if="hasThemes" class="mt-5 grid gap-4 lg:grid-cols-2">
      <section
        v-for="group in [
          {
            type: 'strength',
            title: '高频匹配优势',
            description: '多份 JD 反复认可的简历匹配点',
            themes: profile.jdOverview.strengthThemes,
            color: 'var(--app-success)',
          },
          {
            type: 'gap',
            title: '高频待补强项',
            description: '多份 JD 反复暴露的匹配缺口',
            themes: profile.jdOverview.gapThemes,
            color: 'var(--app-warning)',
          },
        ]"
        :key="group.type"
        class="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full" :style="{ backgroundColor: group.color }" />
              <h3 class="text-sm font-semibold text-highlighted">{{ group.title }}</h3>
            </div>
            <p class="mt-1 text-[11px] leading-5 text-muted">{{ group.description }}</p>
          </div>
          <span class="shrink-0 text-[11px] text-muted">{{ group.themes.length }} 个主题</span>
        </div>

        <div v-if="group.themes.length" class="mt-4 space-y-3">
          <article
            v-for="theme in group.themes"
            :key="theme.themeKey"
            class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-highlighted">{{ theme.label }}</p>
                  <span
                    v-if="theme.needsRevalidation"
                    class="rounded-full border border-[color-mix(in_srgb,var(--app-warning)_30%,var(--app-border))] px-2 py-0.5 text-[10px] text-[var(--app-warning)]"
                  >
                    需用当前简历重验
                  </span>
                </div>
                <p class="mt-1 text-[11px] text-muted">
                  当前版本 {{ theme.currentVersionCount }} 个 · 历史版本 {{ theme.historicalVersionCount }} 个
                </p>
              </div>
              <span class="shrink-0 text-xs font-semibold" :style="{ color: group.color }">
                {{ theme.opportunityCount }}/{{ theme.totalOpportunityCount }} 个岗位
              </span>
            </div>

            <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-muted)]" aria-hidden="true">
              <div
                class="h-full rounded-full transition-[width] duration-300"
                :style="{ width: `${ratioLabel(theme)}%`, backgroundColor: group.color }"
              />
            </div>
            <p class="mt-1.5 text-right text-[10px] text-muted">出现频率 {{ ratioLabel(theme) }}%</p>

            <div class="mt-3 space-y-2">
              <RouterLink
                v-for="source in visibleSources(theme)"
                :key="source.opportunityId"
                :to="`/opportunities/${source.opportunityId}`"
                class="group flex min-w-0 items-start justify-between gap-3 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-[var(--app-surface-muted)] focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span class="min-w-0">
                  <span class="block truncate text-xs font-medium text-highlighted group-hover:text-primary">
                    {{ source.company }} · {{ source.jobTitle }}
                  </span>
                  <span class="mt-0.5 block truncate text-[10px] text-muted">
                    {{ source.originalTitle }} · {{ source.isCurrentVersion ? '当前版本' : `V${source.versionNumber}` }}
                  </span>
                </span>
                <UIcon name="i-lucide-arrow-up-right" class="mt-0.5 size-3.5 shrink-0 text-muted" />
              </RouterLink>
            </div>

            <button
              v-if="theme.sources.length > 3"
              type="button"
              class="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] text-muted outline-none transition-colors hover:bg-[var(--app-surface-muted)] hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary/60"
              :aria-expanded="expandedThemeKeys.includes(theme.themeKey)"
              @click="toggleTheme(theme.themeKey)"
            >
              {{ expandedThemeKeys.includes(theme.themeKey) ? '收起来源' : `查看全部 ${theme.sources.length} 个来源` }}
              <UIcon
                :name="expandedThemeKeys.includes(theme.themeKey) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="size-3.5"
              />
            </button>
          </article>
        </div>
        <div v-else class="mt-4 rounded-xl border border-dashed border-[var(--app-border)] px-4 py-6 text-center">
          <p class="text-xs text-muted">
            暂时没有跨两个以上岗位重复出现的{{ group.type === 'strength' ? '优势' : '待补强项' }}。
          </p>
        </div>
      </section>
    </div>

    <div
      v-else-if="profile.jdSignals.length"
      class="app-panel-muted mt-5 flex min-h-32 flex-col items-center justify-center border-dashed px-5 py-6 text-center"
    >
      <UIcon
        :name="profile.jdOverview.indexingStatus === 'ready' ? 'i-lucide-layers-3' : 'i-lucide-loader-circle'"
        class="size-5 text-muted"
        :class="{ 'animate-spin': profile.jdOverview.indexingStatus !== 'ready' }"
      />
      <p class="mt-3 text-sm font-medium text-highlighted">
        {{ profile.jdOverview.indexingStatus === 'ready' ? '暂时没有跨岗位共性主题' : '正在建立 JD 语义索引' }}
      </p>
      <p class="mt-1 max-w-md text-xs leading-5 text-muted">
        {{
          profile.jdOverview.indexingStatus === 'ready'
            ? '至少在两个岗位中重复出现的信号才进入共性画像，单次信号仍保留在下方原始证据中。'
            : '旧分析会在后台逐步补齐，不影响查看已有逐岗位分析。稍后重新进入本页即可看到聚合结果。'
        }}
      </p>
    </div>

    <div v-if="profile.jdSignals.length" class="mt-5 border-t border-[var(--app-border)] pt-4">
      <button
        type="button"
        class="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-2 text-left outline-none transition-colors hover:bg-[var(--app-surface-muted)] focus-visible:ring-2 focus-visible:ring-primary/60"
        :aria-expanded="isRawEvidenceExpanded"
        @click="isRawEvidenceExpanded = !isRawEvidenceExpanded"
      >
        <span>
          <span class="block text-xs font-semibold text-highlighted">逐岗位原始证据</span>
          <span class="mt-0.5 block text-[11px] text-muted"
            >{{ profile.jdSignals.length }} 条分析 · 保留模型原始结论</span
          >
        </span>
        <UIcon
          :name="isRawEvidenceExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="size-4 text-muted"
        />
      </button>

      <div v-if="isRawEvidenceExpanded" class="mt-3 max-h-[42rem] space-y-3 overflow-y-auto pr-1">
        <article
          v-for="signal in profile.jdSignals"
          :key="signal.opportunityId"
          class="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <RouterLink
                :to="`/opportunities/${signal.opportunityId}`"
                class="truncate text-sm font-semibold text-highlighted hover:text-primary"
              >
                {{ signal.company }} · {{ signal.jobTitle }}
              </RouterLink>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <span>{{ formatDateOnly(signal.updatedAt) }}</span>
                <span>·</span>
                <span>{{ getStatusLabel(signal.opportunityStatus) }}</span>
                <span :class="signal.isCurrentVersion ? 'text-[var(--app-success)]' : 'text-muted'">
                  · {{ signal.isCurrentVersion ? '当前简历版本' : `基于 V${signal.versionNumber}` }}
                </span>
                <span v-if="signal.modelName">· {{ signal.modelName }}</span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="text-lg font-semibold" :class="scoreClass(signal.matchScore)">{{ signal.matchScore }}</span>
              <span
                class="rounded-full px-2 py-1 text-[10px] font-medium"
                :class="getRecommendationClass(signal.recommendation)"
              >
                {{ getRecommendationLabel(signal.recommendation) }}
              </span>
            </div>
          </div>

          <p class="mt-3 line-clamp-2 text-xs leading-5 text-muted">{{ signal.summary }}</p>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <section
              v-for="group in [
                { title: '优势', items: signal.strengths, color: 'var(--app-success)' },
                { title: '待补强', items: signal.gaps, color: 'var(--app-warning)' },
              ]"
              :key="group.title"
            >
              <div class="flex items-center gap-2">
                <span class="size-2 rounded-full" :style="{ backgroundColor: group.color }" />
                <h3 class="text-xs font-semibold text-highlighted">{{ group.title }}</h3>
              </div>
              <div v-if="group.items.length" class="mt-2 space-y-2">
                <div
                  v-for="item in group.items"
                  :key="item.title"
                  class="rounded-xl bg-[var(--app-surface)] px-3 py-2.5"
                >
                  <p class="text-xs font-medium text-highlighted">{{ item.title }}</p>
                  <p class="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">{{ item.reason }}</p>
                </div>
              </div>
              <p v-else class="mt-2 text-xs text-muted">这条分析没有记录{{ group.title }}项。</p>
            </section>
          </div>
          <div v-if="signal.suggestions.length" class="mt-3 border-t border-[var(--app-border)] pt-3">
            <p class="text-[11px] font-medium text-muted">简历建议 · {{ signal.suggestions.length }} 条</p>
            <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted">
              {{ signal.suggestions[0].title }}：{{ signal.suggestions[0].reason }}
            </p>
          </div>
        </article>
      </div>
    </div>

    <div v-else class="app-panel-muted mt-5 border-dashed p-6 text-center">
      <p class="text-sm font-medium text-highlighted">还没有已完成的 JD 分析</p>
      <p class="mt-1 text-xs leading-5 text-muted">完成一条 JD 分析后，优势和待补强信号会自动出现在这里。</p>
      <UButton to="/opportunities" size="sm" variant="outline" color="neutral" class="mt-4">查看机会管理</UButton>
    </div>
  </article>
</template>
