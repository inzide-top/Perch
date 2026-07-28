<script setup lang="ts">
const stats = [
  { label: '当前简历', value: '0', hint: '先创建第一份简历' },
  { label: '岗位机会', value: '0', hint: '后续关联具体简历版本' },
  { label: '模拟面试', value: '0', hint: 'JD 分析完成后开放' },
]
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-6">
    <div class="app-empty-state p-6 sm:p-8">
      <UBadge color="primary" variant="subtle" label="MVP · 本地 Mock" />
      <h1 class="mt-4 text-2xl font-semibold text-highlighted sm:text-3xl">从一条清晰的简历版本链开始</h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-muted">
        当前阶段只搭建前端骨架。下一步由你实现 Resume 与 ResumeVersion 的领域模型和保存规则。
      </p>
      <div class="mt-5">
        <UButton to="/resumes" trailing-icon="i-lucide-arrow-right">进入简历管理</UButton>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <UCard v-for="stat in stats" :key="stat.label" class="app-card">
        <p class="text-sm text-muted">{{ stat.label }}</p>
        <p class="mt-3 text-3xl font-semibold text-highlighted">{{ stat.value }}</p>
        <p class="mt-2 text-xs text-muted">{{ stat.hint }}</p>
      </UCard>
    </div>
  </section>
</template>
