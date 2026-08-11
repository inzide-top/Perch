import assert from 'node:assert/strict'
import test from 'node:test'
import {
  importJobOpportunitiesFromUrls,
  importJobOpportunityFromText,
  importJobOpportunityFromUrl,
  OpportunityImportError,
} from './opportunity-import.service'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('岗位网页导入会整理 Firecrawl 结构化结果并标记缺失字段', async () => {
  let requestBody: Record<string, unknown> = {}
  const preview = await importJobOpportunityFromUrl(
    { url: 'https://jobs.example.com/frontend#detail' },
    {
      apiKey: 'fc-test',
      fetch: (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return jsonResponse({
          success: true,
          data: {
            json: {
              company: '  示例科技  ',
              jobTitle: '前端开发工程师',
              address: ['杭州市', '杭州', '上海市'],
              businessContext: '负责出海业务。',
              responsibilities: ['建设前端工程体系', '优化首屏性能'],
              requirements: ['熟悉 Vue 3'],
              bonusPoints: ['有海外项目经验'],
            },
            metadata: { sourceURL: 'https://jobs.example.com/frontend' },
          },
        })
      }) as typeof fetch,
    },
  )

  assert.equal(requestBody?.url, 'https://jobs.example.com/frontend')
  assert.ok(JSON.stringify(requestBody).includes('responsibilities'), 'Firecrawl 提取结构应按职责、要求和加分项拆分')
  assert.equal(preview.company, '示例科技')
  assert.deepEqual(preview.address, ['杭州', '上海'])
  assert.equal(preview.introduction, '负责出海业务。\n\n工作职责\n- 建设前端工程体系\n- 优化首屏性能')
  assert.equal(preview.description, '任职要求\n- 熟悉 Vue 3\n\n加分项\n- 有海外项目经验')
  assert.deepEqual(preview.missingRequiredFields, [])
  assert.equal(preview.sourceUrl, 'https://jobs.example.com/frontend')
  assert.deepEqual(preview.source, {
    type: 'url',
    label: 'jobs.example.com',
    url: 'https://jobs.example.com/frontend',
  })
})

test('岗位网页没有可用字段时返回可恢复的业务错误', async () => {
  await assert.rejects(
    () =>
      importJobOpportunityFromUrl(
        { url: 'https://example.com/about' },
        {
          apiKey: 'fc-test',
          fetch: (async () =>
            jsonResponse({
              success: true,
              data: {
                json: {
                  company: '',
                  jobTitle: '',
                  address: [],
                  businessContext: '普通公司介绍',
                  responsibilities: [],
                  requirements: [],
                  bonusPoints: [],
                },
              },
            })) as typeof fetch,
        },
      ),
    (error: unknown) =>
      error instanceof OpportunityImportError && error.statusCode === 422 && error.message.includes('未识别到可用'),
  )
})

test('只识别到公司和岗位名称时不能把空内容当成成功预览', async () => {
  await assert.rejects(
    () =>
      importJobOpportunityFromUrl(
        { url: 'https://jobs.example.com/empty-detail' },
        {
          apiKey: 'fc-test',
          fetch: (async () =>
            jsonResponse({
              success: true,
              data: {
                json: {
                  company: '示例科技',
                  jobTitle: '前端开发工程师',
                  address: [],
                  businessContext: '',
                  responsibilities: [],
                  requirements: [],
                  bonusPoints: [],
                },
              },
            })) as typeof fetch,
        },
      ),
    (error: unknown) =>
      error instanceof OpportunityImportError && error.statusCode === 422 && error.message.includes('工作职责'),
  )
})

test('粘贴岗位文本会使用模型做语义分类并复用同一预览结构', async () => {
  let receivedSystemPrompt = ''
  const preview = await importJobOpportunityFromText(
    {
      text: '示例科技招聘前端工程师，负责管理后台建设。要求熟悉 Vue，有可视化经验优先。',
      modelConnection: {
        baseUrl: 'https://model.example.com/v1',
        modelName: 'test-model',
        apiKey: 'test-key',
      },
    },
    {
      requestCompletion: async (_operationKey, _modelConnection, systemPrompt) => {
        receivedSystemPrompt = systemPrompt
        return {
          rawOutput: JSON.stringify({
            company: '示例科技',
            jobTitle: '前端工程师',
            address: [],
            businessContext: '',
            responsibilities: ['负责管理后台建设'],
            requirements: ['熟悉 Vue'],
            bonusPoints: ['有可视化经验'],
          }),
          tokenUsage: null,
        }
      },
    },
  )

  assert.match(receivedSystemPrompt, /不能仅按段落顺序分类/)
  assert.deepEqual(preview.source, { type: 'text', label: '粘贴文本', url: null })
  assert.equal(preview.sourceUrl, null)
  assert.equal(preview.introduction, '工作职责\n- 负责管理后台建设')
  assert.equal(preview.description, '任职要求\n- 熟悉 Vue\n\n加分项\n- 有可视化经验')
})

test('粘贴岗位文本缺少公司和岗位名称时仍返回部分预览并标记待补字段', async () => {
  const preview = await importJobOpportunityFromText(
    {
      text: '工作职责：负责前端工程建设。任职要求：熟悉 Vue 3 和 TypeScript。',
      modelConnection: {
        baseUrl: 'https://model.example.com/v1',
        modelName: 'test-model',
        apiKey: 'test-key',
      },
    },
    {
      requestCompletion: async () => ({
        rawOutput: JSON.stringify({
          responsibilities: '负责前端工程建设',
          requirements: ['熟悉 Vue 3', '熟悉 TypeScript'],
        }),
        tokenUsage: null,
      }),
    },
  )

  assert.equal(preview.company, '')
  assert.equal(preview.jobTitle, '')
  assert.equal(preview.introduction, '工作职责\n- 负责前端工程建设')
  assert.equal(preview.description, '任职要求\n- 熟悉 Vue 3\n- 熟悉 TypeScript')
  assert.deepEqual(preview.missingRequiredFields, ['company', 'jobTitle'])
})

test('粘贴岗位文本的单个字段类型异常不会抹掉其他可用结果', async () => {
  const preview = await importJobOpportunityFromText(
    {
      text: '示例科技招聘前端工程师，工作地点为北京和上海，要求熟悉 Vue。',
      modelConnection: {
        baseUrl: 'https://model.example.com/v1',
        modelName: 'test-model',
        apiKey: 'test-key',
      },
    },
    {
      requestCompletion: async () => ({
        rawOutput: JSON.stringify({
          company: '示例科技',
          jobTitle: '前端工程师',
          address: '北京市，上海市',
          businessContext: { unexpected: true },
          responsibilities: null,
          requirements: '熟悉 Vue\n熟悉 TypeScript',
          bonusPoints: [],
        }),
        tokenUsage: null,
      }),
    },
  )

  assert.deepEqual(preview.address, ['北京', '上海'])
  assert.equal(preview.introduction, '')
  assert.equal(preview.description, '任职要求\n- 熟悉 Vue\n- 熟悉 TypeScript')
  assert.deepEqual(preview.missingRequiredFields, [])
})

test('岗位网页导入拒绝本地地址且不会调用 Firecrawl', async () => {
  let callCount = 0
  await assert.rejects(
    () =>
      importJobOpportunityFromUrl(
        { url: 'http://127.0.0.1:5173/opportunities' },
        {
          apiKey: 'fc-test',
          fetch: (async () => {
            callCount += 1
            return jsonResponse({ success: true })
          }) as typeof fetch,
        },
      ),
    (error: unknown) => error instanceof OpportunityImportError && error.statusCode === 400,
  )
  assert.equal(callCount, 0)
})

test('Firecrawl 额度不足会返回明确错误', async () => {
  await assert.rejects(
    () =>
      importJobOpportunityFromUrl(
        { url: 'https://jobs.example.com/frontend' },
        {
          apiKey: 'fc-test',
          fetch: (async () => jsonResponse({ success: false, error: 'Payment required' }, 402)) as typeof fetch,
        },
      ),
    (error: unknown) =>
      error instanceof OpportunityImportError && error.statusCode === 402 && error.message.includes('额度不足'),
  )
})

test('批量网址导入会保留成功项并单独返回失败项', async () => {
  const result = await importJobOpportunitiesFromUrls(
    {
      urls: ['https://jobs.example.com/frontend', 'https://jobs.example.com/expired'],
    },
    {
      apiKey: 'fc-test',
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { url: string }
        if (body.url.endsWith('/expired')) {
          return jsonResponse({ success: false, error: 'not found' }, 404)
        }

        return jsonResponse({
          success: true,
          data: {
            json: {
              company: '示例科技',
              jobTitle: '前端开发工程师',
              address: [],
              businessContext: '',
              responsibilities: ['建设前端应用'],
              requirements: ['熟悉 Vue'],
              bonusPoints: [],
            },
            metadata: { sourceURL: body.url },
          },
        })
      }) as typeof fetch,
    },
  )

  assert.equal(result.items.length, 2)
  assert.equal(result.items[0]?.status, 'ready')
  assert.equal(result.items[1]?.status, 'failed')
  if (result.items[1]?.status === 'failed') {
    assert.equal(result.items[1].statusCode, 422)
    assert.equal(result.items[1].error, 'not found')
  }
})

test('批量网址导入最多接受 5 条且拒绝重复网址', async () => {
  await assert.rejects(() =>
    importJobOpportunitiesFromUrls(
      {
        urls: [
          'https://jobs.example.com/1',
          'https://jobs.example.com/2',
          'https://jobs.example.com/3',
          'https://jobs.example.com/4',
          'https://jobs.example.com/5',
          'https://jobs.example.com/6',
        ],
      },
      { apiKey: 'fc-test', fetch },
    ),
  )

  await assert.rejects(() =>
    importJobOpportunitiesFromUrls(
      { urls: ['https://jobs.example.com/frontend', 'https://jobs.example.com/frontend/'] },
      { apiKey: 'fc-test', fetch },
    ),
  )
})

test('批量导入会串行处理同一站点的多个网址', async () => {
  let activeSameHostRequests = 0
  let maxSameHostRequests = 0

  const result = await importJobOpportunitiesFromUrls(
    {
      urls: ['https://jobs.example.com/frontend-1', 'https://jobs.example.com/frontend-2'],
    },
    {
      apiKey: 'fc-test',
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { url: string }
        activeSameHostRequests += 1
        maxSameHostRequests = Math.max(maxSameHostRequests, activeSameHostRequests)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeSameHostRequests -= 1

        return jsonResponse({
          success: true,
          data: {
            json: {
              company: '示例科技',
              jobTitle: body.url.endsWith('1') ? '前端工程师一' : '前端工程师二',
              address: [],
              businessContext: '',
              responsibilities: ['建设前端应用'],
              requirements: ['熟悉 Vue'],
              bonusPoints: [],
            },
            metadata: { sourceURL: body.url },
          },
        })
      }) as typeof fetch,
    },
  )

  assert.equal(maxSameHostRequests, 1)
  assert.deepEqual(
    result.items.map((item) => item.status),
    ['ready', 'ready'],
  )
})
