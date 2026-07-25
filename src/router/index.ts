import { createRouter, createWebHistory } from 'vue-router'
import DashboardPage from '@/pages/dashboard/index.vue'
import OpportunitiesPage from '@/pages/opportunity/index.vue'
import ResumePage from '@/pages/resume/index.vue'
import StrategyPage from '@/pages/strategy/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardPage, meta: { title: '首页' } },
    { path: '/resumes', name: 'resumes', component: ResumePage, meta: { title: '简历管理' } },
    { path: '/opportunities', name: 'opportunities', component: OpportunitiesPage, meta: { title: '机会管理' } },
    { path: '/strategy', name: 'strategy', component: StrategyPage, meta: { title: '求职策略' } },
  ],
})

export default router
