<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import perchMarkDarkUrl from '@/assets/brand/perch-mark-dark.png'
import perchMarkLightUrl from '@/assets/brand/perch-mark-light.png'
import { useAuthStore } from '@/stores/auth'
import { getUserErrorMessage } from '@/services/error-presentation'

type AuthView = 'login' | 'register' | 'forgot'
type SignupOutcome = 'existing' | 'confirmation'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const view = ref<AuthView>(route.query.mode === 'register' ? 'register' : 'login')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const passwordVisible = ref(false)
const isSubmitting = ref(false)
const isResending = ref(false)
const isPasswordResetSent = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const signupOutcome = ref<SignupOutcome | null>(null)
const resendMessage = ref('')
const resendError = ref('')
const resendCooldown = ref(0)
let resendCooldownTimer: number | null = null

const heading = computed(() => {
  if (view.value === 'register') return '创建你的求职工作台'
  if (view.value === 'forgot') return '找回登录密码'
  return '欢迎回到 PERCH'
})

const description = computed(() => {
  if (view.value === 'register') return '从第一份简历开始，建立属于你的求职证据链。'
  if (view.value === 'forgot') return '输入注册邮箱，我们会发送安全的密码重置链接。'
  return '继续管理机会、复盘面试，并和 AI 助手一起准备下一步。'
})

function getSafeRedirect() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

function clearResendCooldown() {
  if (resendCooldownTimer !== null) window.clearInterval(resendCooldownTimer)
  resendCooldownTimer = null
  resendCooldown.value = 0
}

function clearSignupOutcome() {
  signupOutcome.value = null
  resendMessage.value = ''
  resendError.value = ''
  clearResendCooldown()
}

function startResendCooldown() {
  clearResendCooldown()
  resendCooldown.value = 30
  resendCooldownTimer = window.setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0) clearResendCooldown()
  }, 1000)
}

function setView(nextView: AuthView) {
  view.value = nextView
  errorMessage.value = ''
  successMessage.value = ''
  isPasswordResetSent.value = false
  clearSignupOutcome()
  password.value = ''
  passwordConfirmation.value = ''
  void router.replace({
    name: 'auth',
    query: {
      ...(route.query.redirect ? { redirect: route.query.redirect } : {}),
      ...(nextView === 'register' ? { mode: 'register' } : {}),
    },
  })
}

function validateInput() {
  const normalizedEmail = email.value.trim()
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return '请输入有效的邮箱地址'
  if (view.value === 'forgot') return ''
  if (password.value.length < 8) return '密码至少需要 8 个字符'
  if (view.value === 'register' && password.value !== passwordConfirmation.value) return '两次输入的密码不一致'
  return ''
}

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return { message: '', code: '' }
  const details = error as { message?: unknown; code?: unknown }
  return {
    message: typeof details.message === 'string' ? details.message : '',
    code: typeof details.code === 'string' ? details.code : '',
  }
}

function isExistingAccountError(error: unknown) {
  const { message, code } = getErrorDetails(error)
  return code === 'user_already_registered' || /user already registered|already registered/i.test(message)
}

function toFriendlyError(error: unknown) {
  const { message } = getErrorDetails(error)
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确'
  if (/email not confirmed/i.test(message)) return '请先前往邮箱完成验证'
  if (/user already registered/i.test(message)) return '这个邮箱已经注册，请直接登录'
  if (/rate limit|too many requests/i.test(message)) return '操作太频繁，请稍后再试'
  return getUserErrorMessage(error, '认证服务暂时不可用，请稍后再试。', 'auth')
}

async function resendConfirmation() {
  if (isResending.value || resendCooldown.value > 0) return

  const normalizedEmail = email.value.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    resendError.value = '请输入有效的邮箱地址'
    return
  }

  resendError.value = ''
  resendMessage.value = ''
  isResending.value = true
  try {
    await authStore.resendSignupConfirmation(normalizedEmail)
    resendMessage.value = '验证邮件已重新发送，请检查收件箱和垃圾邮件。'
    startResendCooldown()
  } catch (error) {
    resendError.value = toFriendlyError(error)
  } finally {
    isResending.value = false
  }
}

async function submit() {
  errorMessage.value = validateInput()
  successMessage.value = ''
  isPasswordResetSent.value = false
  if (view.value === 'register') clearSignupOutcome()
  if (errorMessage.value) return

  isSubmitting.value = true
  try {
    const normalizedEmail = email.value.trim().toLowerCase()
    if (view.value === 'forgot') {
      await authStore.requestPasswordReset(normalizedEmail)
      successMessage.value = '如果该邮箱已经注册，你会收到一封密码重置邮件。'
      isPasswordResetSent.value = true
      return
    }

    if (view.value === 'register') {
      const result = await authStore.signUp(normalizedEmail, password.value)
      if (result.accountState === 'existing') {
        signupOutcome.value = 'existing'
        return
      }
      if (result.requiresEmailConfirmation) {
        signupOutcome.value = 'confirmation'
        return
      }
    } else {
      await authStore.signIn(normalizedEmail, password.value)
    }

    await router.replace(getSafeRedirect())
  } catch (error) {
    if (view.value === 'register' && isExistingAccountError(error)) {
      signupOutcome.value = 'existing'
      return
    }
    errorMessage.value = toFriendlyError(error)
  } finally {
    isSubmitting.value = false
  }
}

watch(
  () => route.query.mode,
  (mode) => {
    if (mode === 'register' && view.value !== 'register') view.value = 'register'
  },
)

watch(email, () => {
  // A result belongs to the email that was submitted. As soon as the user
  // edits the address, unlock the form and remove stale success/error copy.
  if (signupOutcome.value) clearSignupOutcome()
  errorMessage.value = ''
  successMessage.value = ''
  isPasswordResetSent.value = false
})

onUnmounted(clearResendCooldown)
</script>

<template>
  <main
    id="main-content"
    tabindex="-1"
    class="auth-page relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
  >
    <div class="auth-page__glow auth-page__glow--top" aria-hidden="true" />
    <div class="auth-page__glow auth-page__glow--bottom" aria-hidden="true" />

    <section class="relative z-10 w-full max-w-md" aria-labelledby="auth-heading">
      <div class="mb-7 flex flex-col items-center text-center">
        <span
          class="flex size-12 items-center justify-center rounded-2xl border border-default bg-elevated p-1 shadow-sm"
        >
          <img :src="perchMarkLightUrl" alt="" class="size-full object-contain dark:hidden" />
          <img :src="perchMarkDarkUrl" alt="" class="hidden size-full object-contain dark:block" />
        </span>
        <p class="mt-3 text-sm font-semibold tracking-[0.18em] text-highlighted">PERCH</p>
        <p class="mt-1 text-xs text-muted">Where rest becomes readiness.</p>
      </div>

      <div class="app-panel border border-default p-5 shadow-[0_22px_70px_rgb(15_23_42/10%)] sm:p-7">
        <div>
          <h1 id="auth-heading" class="text-xl font-semibold tracking-tight text-highlighted">{{ heading }}</h1>
          <p class="mt-2 text-sm leading-6 text-muted">{{ description }}</p>
        </div>

        <div v-if="view !== 'forgot'" class="mt-6 grid grid-cols-2 rounded-xl bg-elevated p-1" role="tablist">
          <button
            type="button"
            role="tab"
            class="h-9 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            :class="view === 'login' ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
            :aria-selected="view === 'login'"
            @click="setView('login')"
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            class="h-9 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            :class="view === 'register' ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
            :aria-selected="view === 'register'"
            @click="setView('register')"
          >
            注册
          </button>
        </div>

        <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
          <UFormField label="邮箱" required>
            <UInput
              v-model="email"
              type="email"
              autocomplete="email"
              icon="i-lucide-mail"
              size="lg"
              class="w-full"
              placeholder="name@example.com"
              :disabled="isSubmitting || isResending"
            />
          </UFormField>

          <UFormField v-if="view !== 'forgot'" label="密码" required>
            <UInput
              v-model="password"
              :type="passwordVisible ? 'text' : 'password'"
              :autocomplete="view === 'register' ? 'new-password' : 'current-password'"
              icon="i-lucide-lock-keyhole"
              size="lg"
              class="w-full"
              placeholder="至少 8 个字符"
              :disabled="isSubmitting"
            >
              <template #trailing>
                <UButton
                  type="button"
                  color="neutral"
                  variant="link"
                  size="xs"
                  :icon="passwordVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
                  @click="passwordVisible = !passwordVisible"
                />
              </template>
            </UInput>
          </UFormField>

          <UFormField v-if="view === 'register'" label="确认密码" required>
            <UInput
              v-model="passwordConfirmation"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="new-password"
              icon="i-lucide-shield-check"
              size="lg"
              class="w-full"
              placeholder="再次输入密码"
              :disabled="isSubmitting"
            />
          </UFormField>

          <p v-if="errorMessage" role="alert" class="rounded-xl bg-error/10 px-3 py-2.5 text-sm text-error">
            {{ errorMessage }}
          </p>
          <p v-if="successMessage" role="status" class="rounded-xl bg-success/10 px-3 py-2.5 text-sm text-success">
            {{ successMessage }}
          </p>

          <div v-if="signupOutcome" class="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3.5" role="status">
            <p class="text-sm font-medium text-highlighted">
              {{
                signupOutcome === 'existing'
                  ? '这个邮箱已经注册，请选择下一步操作。'
                  : '验证邮件已发送，请前往邮箱完成验证。'
              }}
            </p>
            <p class="mt-1 text-xs leading-5 text-muted">
              {{
                signupOutcome === 'existing'
                  ? '你可以直接登录或使用找回密码。'
                  : '如果之前注册过但还没完成验证，可以重发验证邮件。'
              }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <UButton type="button" size="sm" variant="soft" label="去登录" @click="setView('login')" />
              <UButton type="button" size="sm" variant="outline" label="找回密码" @click="setView('forgot')" />
              <UButton
                v-if="signupOutcome === 'confirmation'"
                type="button"
                size="sm"
                variant="link"
                :loading="isResending"
                :disabled="isResending || resendCooldown > 0"
                :label="resendCooldown > 0 ? `重新发送（${resendCooldown}s）` : '重发验证邮件'"
                @click="resendConfirmation"
              />
            </div>
            <p v-if="resendMessage" class="mt-2 text-xs text-success">{{ resendMessage }}</p>
            <p v-if="resendError" role="alert" class="mt-2 text-xs text-error">{{ resendError }}</p>
          </div>

          <UButton
            type="submit"
            block
            size="lg"
            :loading="isSubmitting"
            :disabled="isSubmitting || isResending || isPasswordResetSent || Boolean(signupOutcome)"
            :label="view === 'login' ? '登录' : view === 'register' ? '创建账号' : '发送重置邮件'"
          />
        </form>

        <div class="mt-5 flex items-center justify-center">
          <button
            v-if="view === 'login'"
            type="button"
            class="text-sm text-muted transition-colors hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            @click="setView('forgot')"
          >
            忘记密码？
          </button>
          <button
            v-else-if="view === 'forgot'"
            type="button"
            class="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            @click="setView('login')"
          >
            <UIcon name="i-lucide-arrow-left" class="size-4" />
            返回登录
          </button>
        </div>
      </div>

      <p class="mt-5 text-center text-xs leading-5 text-dimmed">登录后，你的简历、机会和对话只会归属于当前账号。</p>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  background:
    linear-gradient(var(--app-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--app-border) 1px, transparent 1px), var(--app-bg);
  background-size: 48px 48px;
}

.auth-page::after {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, transparent 0, var(--app-bg) 72%);
  content: '';
  pointer-events: none;
}

.auth-page__glow {
  position: absolute;
  width: 24rem;
  height: 24rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--app-accent) 13%, transparent);
  filter: blur(80px);
  pointer-events: none;
}

.auth-page__glow--top {
  top: -12rem;
  right: -8rem;
}

.auth-page__glow--bottom {
  bottom: -14rem;
  left: -8rem;
}

@media (prefers-reduced-motion: reduce) {
  .auth-page * {
    scroll-behavior: auto !important;
  }
}
</style>
