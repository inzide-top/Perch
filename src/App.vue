<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'

const route = useRoute()
const isDark = ref(false)
const pageTitle = computed(() => String(route.meta.title ?? 'Agent Seek Employment'))

watch(isDark, (enabled) => document.documentElement.classList.toggle('dark', enabled), { immediate: true })
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-default text-default">
      <AppSidebar />
      <div class="lg:pl-64">
        <AppHeader v-model:is-dark="isDark" :title="pageTitle" />
        <main class="px-4 py-6 sm:px-6 lg:px-8">
          <RouterView />
        </main>
      </div>
    </div>
  </UApp>
</template>
