# 官方模型服务白名单

核对日期：2026-09-19。以下仅为允许访问的官方来源及兼容接口地址，不代表已用真实 API Key 完成 Perch 的全部功能测试。没有预置任何供应商 Key 或第三方中转。

## 后端环境变量

```dotenv
# Railway 公共服务使用限制模式
MODEL_ALLOW_UNRESTRICTED_LOCAL=false
MODEL_ALLOWED_ORIGINS=https://api.openai.com,https://api.deepseek.com,https://api.minimax.io,https://api.minimax.cn,https://api.moonshot.cn,https://api.moonshot.ai,https://api.anthropic.com,https://dashscope.aliyuncs.com,https://dashscope-intl.aliyuncs.com,https://generativelanguage.googleapis.com
```

本地 `.env` 和 GitHub `.env.example` 默认设置 `MODEL_ALLOW_UNRESTRICTED_LOCAL=true`，允许任意 HTTP/HTTPS 地址并忽略名单。线上公共部署请在 Fastify 后端设置上面的 false 与名单，然后重新部署/重启。Vercel 前端不会自动上传本地 `.env`，此项不使用 `VITE_` 前缀。仅开关为精确的小写 true（允许首尾空格）时解除地址限制；否则白名单缺失或清空会拒绝聊天模型请求。开关不受 NODE_ENV 约束；两种模式仍禁止重定向并保留超时。

## 用户设置里的 Base URL

| 服务                  | Base URL                                                  | 官方文档                                                                                     |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| OpenAI                | `https://api.openai.com/v1`                               | [Chat Completions](https://developers.openai.com/api/reference/resources/chat)               |
| DeepSeek              | `https://api.deepseek.com/v1`                             | [快速开始](https://api-docs.deepseek.com/)                                                   |
| MiniMax 国际          | `https://api.minimax.io/v1`                               | [OpenAI 兼容接口](https://platform.minimax.io/docs/api-reference/text-openai-api)            |
| MiniMax 中国          | `https://api.minimax.cn/v1`                               | [OpenAI 兼容接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)            |
| Kimi 中国             | `https://api.moonshot.cn/v1`                              | [快速开始](https://platform.kimi.com/docs/get-api-key)                                       |
| Kimi 国际             | `https://api.moonshot.ai/v1`                              | [快速开始](https://platform.kimi.ai/docs/overview)                                           |
| Claude / Anthropic    | `https://api.anthropic.com/v1`                            | [OpenAI 兼容层](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk) |
| 通义千问 / 百炼北京   | `https://dashscope.aliyuncs.com/compatible-mode/v1`       | [地区与接口地址](https://www.alibabacloud.com/help/en/model-studio/base-url)                 |
| 通义千问 / 百炼新加坡 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`  | [地区与接口地址](https://www.alibabacloud.com/help/en/model-studio/base-url)                 |
| Gemini                | `https://generativelanguage.googleapis.com/v1beta/openai` | [OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)                              |

Base URL 包含接口路径，后端白名单只包含来源。Perch 会追加 `/chat/completions`。模型名称与 Key 由用户根据所选服务、账号地区及可用模型填写，不能把不同地区的 Key 混用。API 账户与网页聊天订阅不是同一配置。

## 兼容性边界

- Perch 当前使用 OpenAI Chat Completions 格式。白名单只决定能否发送网络请求，不自动适配不同模型的参数、工具调用或推理字段。
- Claude 官方兼容层定位于评估比较；`response_format` 和工具 `strict` 等字段会被忽略。当前没有实现原生 Messages API 适配。用于简历识别、结构化分析前应单独验证。
- Gemini 和其他推理模型可能有多轮工具调用所需的额外字段、温度或输出限制；没有真实联调前，不宣传“全部模型完整支持”。
- MiniMax 的推理字段与部分多轮工具调用存在供应商要求，需以实际使用模型验证。旧域名、专属 Coding 套餐、企业代理与 Azure 等区域/实例地址不在此默认列表中。
- 录制前用计划展示的单一模型跑通 PDF 导入、JD 分析、模拟面试和助手工具调用。不要为了验证所有供应商购买额外 Key。

## 添加第三方中转

由管理员确认可信度与接口兼容性，再向 `MODEL_ALLOWED_ORIGINS` 追加 `https://实际中转域名`（若不是 443，包含端口），重启后端。不要使用通配符，也不要直接允许所有用户提交的地址。
