import { createHash } from 'node:crypto'
import type { JobOpportunity } from '@/types/opportunity'

type OpportunityFingerprintInput = Pick<
  JobOpportunity,
  'company' | 'jobTitle' | 'address' | 'introduction' | 'description'
>

function normalizeFingerprintText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 只用于识别同一用户录入的规范化精确重复 JD：忽略空格、换行、标点、全半角和英文大小写。
 * 不做公司别名、错别字或语义相似度判断，避免误拦截不同岗位。
 */
export function createOpportunityFingerprint(input: OpportunityFingerprintInput) {
  const source = {
    company: normalizeFingerprintText(input.company),
    jobTitle: normalizeFingerprintText(input.jobTitle),
    address: [...(input.address ?? [])].map(normalizeFingerprintText).sort(),
    introduction: normalizeFingerprintText(input.introduction),
    description: normalizeFingerprintText(input.description),
  }

  return createHash('sha256').update(JSON.stringify(source)).digest('hex')
}
