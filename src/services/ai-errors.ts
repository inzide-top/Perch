import type { AiTaskError } from '@/types/ai'

export type AiTaskErrorPresentation = {
  title: string
  description: string
  requiresModelAttention: boolean
}

export function isAiTaskError(value: unknown): value is AiTaskError {
  if (!value || typeof value !== 'object') return false
  const error = value as Partial<AiTaskError>
  return typeof error.code === 'string' && typeof error.message === 'string'
}

export function getAiTaskErrorPresentation(value: unknown): AiTaskErrorPresentation {
  const error = isAiTaskError(value) ? value : null

  if (error?.code === 'model_quota_exhausted') {
    return {
      title: '当前模型额度不足',
      description: '请检查模型服务商余额或消费额度，也可以切换到其他可用模型后重试。',
      requiresModelAttention: true,
    }
  }

  if (error?.code === 'model_authentication_failed') {
    return {
      title: '模型鉴权失败',
      description: '请检查 API Key 是否填写正确、仍然有效并具有当前模型的访问权限。',
      requiresModelAttention: true,
    }
  }

  if (error?.code === 'model_configuration_invalid') {
    return {
      title: '模型配置不可用',
      description: '请检查 Base URL、模型名称和接口兼容性，确认后再重新执行任务。',
      requiresModelAttention: true,
    }
  }

  if (error?.code === 'rate_limited') {
    return {
      title: '模型请求过于频繁',
      description: '服务商正在限流，请稍后再试。',
      requiresModelAttention: false,
    }
  }

  if (error?.code === 'timeout') {
    return {
      title: '模型响应超时',
      description: '本次模型响应超过等待时间，可以重新执行任务。',
      requiresModelAttention: false,
    }
  }

  return {
    title: 'AI 任务执行失败',
    description: error?.message || '模型暂时没有返回可用结果，可以重新执行任务。',
    requiresModelAttention: false,
  }
}
