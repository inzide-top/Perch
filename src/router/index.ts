import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/pages/dashboard/index.vue'), meta: { title: '首页' } },
    {
      path: '/resumes',
      name: 'resumes',
      component: () => import('@/pages/resume/index.vue'),
      meta: { title: '简历管理' },
    },
    {
      path: '/opportunities',
      name: 'opportunities',
      component: () => import('@/pages/opportunity/index.vue'),
      meta: { title: '机会管理' },
    },
    {
      path: '/opportunities/:id/interviews',
      name: 'opportunity-interviews',
      redirect: (to) => ({
        name: 'opportunity-detail',
        params: { id: to.params.id },
        query: { section: 'mock-interview' },
      }),
      meta: { title: '模拟面试', workspacePage: true },
    },
    {
      path: '/opportunities/:id/interviews/:sessionId',
      name: 'opportunity-interview-session',
      component: () => import('@/pages/opportunity/detail/interview/pages/InterviewSessionPage.vue'),
      meta: { title: '模拟面试', workspacePage: true },
    },
    {
      path: '/opportunities/:id',
      name: 'opportunity-detail',
      component: () => import('@/pages/opportunity/detail/index.vue'),
      meta: { title: 'JD 分析详情', workspacePage: true },
    },
    {
      path: '/strategy',
      name: 'strategy',
      component: () => import('@/pages/strategy/index.vue'),
      meta: { title: '求职策略' },
    },
    {
      path: '/strategy/actions',
      name: 'strategy-actions',
      component: () => import('@/pages/strategy/actions.vue'),
      meta: { title: '行动策略' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/settings/index.vue'),
      meta: { title: '系统设置' },
    },
    {
      path: '/developer/agent-runs',
      name: 'agent-runs',
      component: () => import('@/pages/developer/agent-runs/index.vue'),
      meta: { title: 'AgentRun 调试台' },
    },
  ],
})

export default router
