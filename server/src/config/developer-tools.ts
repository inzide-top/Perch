/** 后端调试接口采用显式开启策略，配置缺失或拼写错误时一律关闭。 */
export const developerToolsEnabled = process.env.ENABLE_DEVELOPER_TOOLS === 'true'
