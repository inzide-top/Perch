# 参与 Perch

欢迎提交可复现的问题、使用反馈和范围明确的改进。项目使用 MIT 许可证。

## 本地开发

按 [README](./README.md#quick-start) 配置 Node.js、pnpm、数据库与环境变量。使用独立开发数据库和[虚构样例](./docs/demo/README.md)，不要把生产数据复制到测试夹具中。

前端使用 Vue 与 TypeScript，后端使用 Fastify、Drizzle 和 PostgreSQL。功能修改请同时考虑加载、空数据、失败、重试和用户身份边界。

## 提交问题

通过 [Issues](https://github.com/inzide-top/Perch/issues) 提供：

- 使用的提交/版本、浏览器及部署方式；
- 可复现步骤、预期行为和实际行为；
- 已脱敏的报错和截图。

不要上传真实简历、联系方式、API Key、访问令牌或数据库连接口令。涉及安全漏洞与敏感数据时，不要直接公开利用细节；先确认维护者提供的私下报告渠道。

## 提交改动

1. 从当前 main 创建独立分支，保持改动聚焦。
2. 修复 Bug 时说明触发条件和前后行为，为关键逻辑补充必要验证。
3. 更新受影响的说明和无真实值的环境变量示例。
4. 在 PR 中写清改动、验证结果和未验证项；不把未运行的检查写成通过。

提交前按修改范围运行检查；完整 CI 包括：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm typecheck:server
pnpm test:core
pnpm exec drizzle-kit check
pnpm build
```

检索、岗位导入和 PDF 导入各有专门脚本，见 README。只改文档时检查格式、链接和说明准确性即可；数据库修改另需在独立数据库验证迁移。不要在真实部署数据库上试跑修复或清理脚本。
