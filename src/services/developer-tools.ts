const configuredValue = import.meta.env.VITE_ENABLE_DEVELOPER_TOOLS

/**
 * 本地 Vite 开发默认开放调试台；生产构建缺少配置时默认关闭。
 * 该值只负责前端体验，真正的访问边界由后端独立控制。
 */
export const developerToolsEnabled =
  configuredValue === 'true' || (configuredValue === undefined && import.meta.env.DEV)
