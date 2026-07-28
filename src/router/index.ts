import { createRouter, createWebHistory } from 'vue-router'
import DashboardPage from '@/pages/dashboard/index.vue'
import OpportunityDetailPage from '@/pages/opportunity/detail/index.vue'
import OpportunitiesPage from '@/pages/opportunity/index.vue'
import ResumePage from '@/pages/resume/index.vue'
import SettingsPage from '@/pages/settings/index.vue'
import StrategyPage from '@/pages/strategy/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardPage, meta: { title: '首页' } },
    { path: '/resumes', name: 'resumes', component: ResumePage, meta: { title: '简历管理' } },
    { path: '/opportunities', name: 'opportunities', component: OpportunitiesPage, meta: { title: '机会管理' } },
    {
      path: '/opportunities/:id',
      name: 'opportunity-detail',
      component: OpportunityDetailPage,
      meta: { title: 'JD 分析详情' },
    },
    { path: '/strategy', name: 'strategy', component: StrategyPage, meta: { title: '求职策略' } },
    { path: '/settings', name: 'settings', component: SettingsPage, meta: { title: '系统设置' } },
  ],
})

export default router
