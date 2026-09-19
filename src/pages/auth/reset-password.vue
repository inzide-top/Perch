<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import perchMarkDarkUrl from '@/assets/brand/perch-mark-dark.png'
import perchMarkLightUrl from '@/assets/brand/perch-mark-light.png'
import { useAuthStore } from '@/stores/auth'
import { getUserErrorMessage } from '@/services/error-presentation'

const router = useRouter()
const authStore = useAuthStore()
const password = ref('')
const passwordConfirmation = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

async function submit() {
  errorMessage.value = ''
  if (password.value.length < 8) {
    errorMessage.value = '密码至少需要 8 个字符'
    return
  }
  if (password.value !== passwordConfirmation.value) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }

  isSubmitting.value = true
  try {
    await authStore.updatePassword(password.value)
    successMessage.value = '密码已经更新，正在进入工作台。'
    window.setTimeout(() => void router.replace('/'), 700)
  } catch (error) {
    errorMessage.value = getUserErrorMessage(error, '密码更新失败，请重新打开邮件中的链接。', 'auth')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main
    id="main-content"
    tabindex="-1"
    class="flex min-h-dvh items-center justify-center bg-[var(--app-bg)] px-4 py-10"
  >
    <section class="w-full max-w-md" aria-labelledby="reset-password-heading">
      <div class="mb-6 flex flex-col items-center">
        <span
          class="flex size-12 items-center justify-center rounded-2xl border border-default bg-elevated p-1 shadow-sm"
        >
          <img :src="perchMarkLightUrl" alt="" class="size-full object-contain dark:hidden" />
          <img :src="perchMarkDarkUrl" alt="" class="hidden size-full object-contain dark:block" />
        </span>
      </div>

      <div class="app-panel border border-default p-5 shadow-[0_22px_70px_rgb(15_23_42/10%)] sm:p-7">
        <h1 id="reset-password-heading" class="text-xl font-semibold tracking-tight text-highlighted">设置新密码</h1>
        <p class="mt-2 text-sm leading-6 text-muted">新密码至少需要 8 个字符，更新后会继续进入 PERCH。</p>

        <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
          <UFormField label="新密码" required>
            <UInput
              v-model="password"
              type="password"
              autocomplete="new-password"
              icon="i-lucide-lock-keyhole"
              size="lg"
              class="w-full"
              :disabled="isSubmitting"
            />
          </UFormField>
          <UFormField label="确认新密码" required>
            <UInput
              v-model="passwordConfirmation"
              type="password"
              autocomplete="new-password"
              icon="i-lucide-shield-check"
              size="lg"
              class="w-full"
              :disabled="isSubmitting"
            />
          </UFormField>

          <p v-if="errorMessage" role="alert" class="rounded-xl bg-error/10 px-3 py-2.5 text-sm text-error">
            {{ errorMessage }}
          </p>
          <p v-if="successMessage" role="status" class="rounded-xl bg-success/10 px-3 py-2.5 text-sm text-success">
            {{ successMessage }}
          </p>

          <UButton type="submit" block size="lg" label="更新密码" :loading="isSubmitting" :disabled="isSubmitting" />
        </form>
      </div>
    </section>
  </main>
</template>
