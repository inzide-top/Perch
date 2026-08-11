import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatSystemPrompt } from './chat-system-prompt'

test('全局聊天 Prompt 使用 PERCH 产品身份且不冒充已执行工具', () => {
  const prompt = buildChatSystemPrompt({ scopeType: 'global', opportunity: null })

  assert.match(prompt, /PERCH AI 助手/)
  assert.match(prompt, /不要把底层模型名称或模型供应商当作你的产品身份/)
  assert.match(prompt, /即使历史助手消息曾经使用底层模型名称自称/)
  assert.match(prompt, /不得声称已经执行尚未通过工具完成的操作/)
  assert.match(prompt, /必须调用工具并等待真实结果/)
  assert.match(prompt, /同一次助手响应中同时返回 tool_call/)
  assert.match(prompt, /只有内部历史工具状态明确标记为已完成的修改/)
  assert.match(prompt, /绝不能在回答中引用、复述、解释/)
  assert.match(prompt, /“下周二”属于紧接着的下一自然周/)
  assert.match(prompt, /绝不能把“下周二”解释成明天/)
  assert.match(prompt, /当前是全局求职对话/)
  assert.match(prompt, /机会列表时，调用 search_opportunities/)
  assert.match(prompt, /具体机会的全貌.*调用 get_opportunity_context/)
  assert.match(prompt, /整体能力.*调用 get_capability_profile/)
  assert.match(prompt, /具体机会下的优势或差距.*get_opportunity_context/)
  assert.match(prompt, /今天优先做什么.*调用 get_action_strategy/)
  assert.match(prompt, /不会重新生成策略/)
  assert.match(prompt, /同一名称匹配多条记录时.*展示目标机会选择卡/)
  assert.match(prompt, /修改某一个机会的意向等级.*调用 update_opportunity_profile/)
  assert.match(prompt, /修改某一个机会的求职阶段.*调用 transition_opportunity_status/)
  assert.match(prompt, /新增未来的真实面试安排.*调用 create_interview_schedule/)
  assert.match(prompt, /新建、开始或安排 AI 模拟面试时，调用 create_mock_interview/)
  assert.match(prompt, /真实面试安排不使用该工具/)
  assert.match(prompt, /真实笔试复盘时，调用 save_written_test_review/)
  assert.match(prompt, /真实面试轮次复盘时，调用 save_interview_review/)
  assert.match(prompt, /机会、轮次或正文无法确定时仍然调用/)
  assert.match(prompt, /缺失字段仍然调用并省略，由产品表单补齐/)
  assert.match(prompt, /同时修改 2 到 10 个机会.*调用 batch_update_opportunity_profiles/)
  assert.match(prompt, /写入工具的确认由产品卡片完成/)
})

test('机会聊天 Prompt 注入绑定机会并明确禁止混入其他机会', () => {
  const prompt = buildChatSystemPrompt({
    scopeType: 'opportunity',
    opportunity: {
      company: '小米',
      jobTitle: '前端工程师',
      status: 'interviewing',
      intentionLevel: 'S',
      industry: '互联网',
      address: ['上海'],
      description: '负责前端工程化建设',
      includeWrittenTest: false,
      note: '重点准备 Vue 原理',
    },
  })

  assert.match(prompt, /默认只围绕下面这一个绑定岗位机会回答/)
  assert.match(prompt, /一次性机会引用.*本轮读取.*不会改变会话绑定关系/)
  assert.match(prompt, /必须在当前响应中调用 update_opportunity_profile/)
  assert.match(prompt, /笔试流程开关/)
  assert.match(prompt, /必须在当前响应中调用 transition_opportunity_status/)
  assert.match(prompt, /必须调用 create_interview_schedule/)
  assert.match(prompt, /当前机会未开启笔试流程，不能保存笔试复盘/)
  assert.match(prompt, /产品会展示补充信息表单/)
  assert.match(prompt, /不要在正文里再次询问“是否确认”/)
  assert.match(prompt, /由产品确认卡片拦截/)
  assert.match(prompt, /工具结果返回前，不得输出“已修改”/)
  assert.match(prompt, /工具能够处理的操作不得声称“不支持”/)
  assert.match(prompt, /关闭笔试流程.*includeWrittenTest.*false/)
  assert.match(prompt, /公司：小米/)
  assert.match(prompt, /岗位：前端工程师/)
  assert.match(prompt, /负责前端工程化建设/)
  assert.match(prompt, /重点准备 Vue 原理/)
})

test('开启笔试流程后 Prompt 强制使用笔试复盘工具并保留缺参补全', () => {
  const prompt = buildChatSystemPrompt({
    scopeType: 'opportunity',
    opportunity: {
      company: '微派',
      jobTitle: '前端开发',
      status: 'written_test',
      intentionLevel: 'A',
      industry: '互联网',
      address: ['武汉'],
      description: '负责 H5 业务',
      includeWrittenTest: true,
      note: '',
    },
  })

  assert.match(prompt, /必须调用 save_written_test_review/)
  assert.match(prompt, /省略 reviewNote，由产品表单补全/)
  assert.match(prompt, /默认 mode=append/)
  assert.match(prompt, /不得把复盘内容当作普通机会备注保存/)
  assert.match(prompt, /必须调用 save_interview_review/)
  assert.match(prompt, /无法唯一确定轮次或缺少复盘正文时仍要调用/)
})
