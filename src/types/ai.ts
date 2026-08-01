export type AiModelErrorCode =
  | 'structured_output_validation_failed'
  | 'model_request_failed'
  | 'model_quota_exhausted'
  | 'model_authentication_failed'
  | 'model_configuration_invalid'
  | 'timeout'
  | 'rate_limited'
  | 'cancelled'
  | 'unknown'

export type AiTaskError = {
  code: AiModelErrorCode
  message: string
  retryable: boolean
}
