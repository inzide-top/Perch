import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpportunityFingerprint } from './opportunity-fingerprint'

const baseOpportunity = {
  company: 'Bilibili',
  jobTitle: 'AI Native 开发工程师（前端方向）',
  address: ['上海', '杭州'],
  introduction: '负责 AI Workflow、Agent 和前端应用开发。',
  description: '熟练掌握 TypeScript、Vue 或 React。',
}

test('JD 指纹忽略空格、换行、标点、全半角和英文大小写', () => {
  const formattedCopy = {
    ...baseOpportunity,
    company: 'bilibili ',
    jobTitle: 'ＡＩ Native\n开发工程师（前端方向）',
    address: ['杭州', ' 上 海 '],
    introduction: '负责 AI Workflow / Agent，和前端应用开发！',
    description: '熟练掌握 TypeScript、 Vue 或 React。',
  }

  assert.equal(createOpportunityFingerprint(baseOpportunity), createOpportunityFingerprint(formattedCopy))
})

test('JD 指纹不会把业务内容不同的岗位误判为重复', () => {
  const changedDescription = {
    ...baseOpportunity,
    description: '熟练掌握 TypeScript、Vue 或 React，并负责供应链系统交付。',
  }

  assert.notEqual(createOpportunityFingerprint(baseOpportunity), createOpportunityFingerprint(changedDescription))
})
