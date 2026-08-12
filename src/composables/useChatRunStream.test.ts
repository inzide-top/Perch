import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRunEventRecord } from '@/services/chat-stream'
import { readToolConfirmationRequest } from '@/shared/chat/confirmation'
import { readToolInputRequest } from '@/shared/chat/input-request'

function createConfirmationEvent(presentation: Record<string, unknown>): ChatRunEventRecord {
  return {
    id: 'event-1',
    runId: 'run-1',
    sequence: 1,
    eventType: 'confirmation_requested',
    stateRevision: 2,
    payload: {
      toolActionId: 'tool-action-1',
      callId: 'call-1',
      toolName: 'update_opportunity_profile',
      presentation,
    },
    createdAt: '2026-08-09T00:00:00.000Z',
  }
}

test('流事件可以恢复新的机会资料确认卡', () => {
  const confirmation = readToolConfirmationRequest(
    createConfirmationEvent({
      kind: 'opportunity_profile_change',
      title: '修改机会资料',
      opportunityId: '00000000-0000-4000-8000-000000000001',
      company: '微派',
      jobTitle: '前端开发工程师',
      changes: [
        { field: 'intentionLevel', label: '意向等级', before: 'A', after: 'S' },
        { field: 'note', label: '备注', before: '未填写', after: '优先跟进' },
      ],
    }),
  )

  assert.equal(confirmation?.toolName, 'update_opportunity_profile')
  assert.equal(confirmation?.presentation.kind, 'opportunity_profile_change')
})

test('流事件可以恢复批量机会资料确认卡', () => {
  const confirmation = readToolConfirmationRequest(
    createConfirmationEvent({
      kind: 'opportunity_profile_batch_change',
      title: '批量修改机会资料',
      items: [
        {
          kind: 'opportunity_profile_change',
          title: '修改机会资料',
          opportunityId: '00000000-0000-4000-8000-000000000001',
          company: '微派',
          jobTitle: '前端开发',
          changes: [{ field: 'intentionLevel', label: '意向等级', before: 'B', after: 'A' }],
        },
        {
          kind: 'opportunity_profile_change',
          title: '修改机会资料',
          opportunityId: '00000000-0000-4000-8000-000000000002',
          company: '小米',
          jobTitle: '前端工程师',
          changes: [{ field: 'note', label: '备注', before: '未填写', after: '优先跟进' }],
        },
      ],
    }),
  )

  assert.equal(confirmation?.presentation.kind, 'opportunity_profile_batch_change')
})

test('流事件可以恢复机会阶段确认卡并拒绝未知展示结构', () => {
  const statusConfirmation = readToolConfirmationRequest(
    createConfirmationEvent({
      kind: 'opportunity_status_transition',
      title: '修改机会阶段',
      opportunityId: '00000000-0000-4000-8000-000000000001',
      company: '微派',
      jobTitle: '前端开发工程师',
      before: 'pending_apply',
      beforeLabel: '待投递',
      after: 'interviewing',
      afterLabel: '面试中',
      direction: 'forward',
      enableWrittenTest: false,
      warning: null,
    }),
  )

  assert.equal(statusConfirmation?.presentation.kind, 'opportunity_status_transition')
  assert.equal(readToolConfirmationRequest(createConfirmationEvent({ kind: 'unknown' })), null)
})

test('流事件可以恢复面试安排补充表单和创建确认卡', () => {
  const inputRequest = readToolInputRequest({
    ...createConfirmationEvent({}),
    eventType: 'input_requested',
    payload: {
      requestId: '00000000-0000-4000-8000-000000000011',
      toolActionId: '00000000-0000-4000-8000-000000000012',
      callId: 'call-schedule',
      toolName: 'create_interview_schedule',
      missingArguments: ['type', 'scheduledAt'],
      presentation: {
        kind: 'interview_schedule_input',
        title: '补全面试安排',
        opportunityId: '00000000-0000-4000-8000-000000000001',
        company: '微派',
        jobTitle: '前端开发工程师',
        missingArguments: ['type', 'scheduledAt'],
        values: {},
      },
    },
  })
  assert.equal(inputRequest?.presentation.kind, 'interview_schedule_input')

  const confirmation = readToolConfirmationRequest(
    createConfirmationEvent({
      kind: 'interview_schedule_create',
      title: '创建面试安排',
      opportunityId: '00000000-0000-4000-8000-000000000001',
      company: '微派',
      jobTitle: '前端开发工程师',
      roundType: 'project',
      roundTypeLabel: '项目面',
      roundTitle: '二面',
      scheduledAt: '2099-08-12T19:00:00+08:00',
      note: '',
    }),
  )
  assert.equal(confirmation?.presentation.kind, 'interview_schedule_create')
})

test('流事件可以恢复全局机会目标选择卡', () => {
  const inputRequest = readToolInputRequest({
    ...createConfirmationEvent({}),
    eventType: 'input_requested',
    payload: {
      requestId: '00000000-0000-4000-8000-000000000031',
      toolActionId: '00000000-0000-4000-8000-000000000032',
      callId: 'call-opportunity-context',
      toolName: 'get_opportunity_context',
      missingArguments: ['opportunityId'],
      presentation: {
        kind: 'opportunity_target_input',
        title: '选择目标机会',
        reason: 'ambiguous_reference',
        reference: '小米',
        sections: ['profile', 'job_analysis'],
        candidates: [
          {
            opportunityId: '00000000-0000-4000-8000-000000000001',
            company: '小米',
            jobTitle: '前端工程师',
            status: 'interviewing',
            statusLabel: '面试中',
            intentionLevel: 'A',
            updatedAt: '2026-08-10T00:00:00.000Z',
          },
        ],
      },
    },
  })

  assert.equal(inputRequest?.toolName, 'get_opportunity_context')
  assert.equal(inputRequest?.presentation.kind, 'opportunity_target_input')
})

test('流事件可以恢复复盘补充表单和保存确认卡', () => {
  const opportunityId = '00000000-0000-4000-8000-000000000001'
  const inputRequest = readToolInputRequest({
    ...createConfirmationEvent({}),
    eventType: 'input_requested',
    payload: {
      requestId: '00000000-0000-4000-8000-000000000021',
      toolActionId: '00000000-0000-4000-8000-000000000022',
      callId: 'call-review',
      toolName: 'save_written_test_review',
      missingArguments: ['reviewNote'],
      presentation: {
        kind: 'review_input',
        sourceType: 'written_test',
        sourceLabel: '笔试复盘',
        title: '补充笔试复盘',
        opportunityId,
        company: '微派',
        jobTitle: '前端开发工程师',
        target: { type: 'opportunity', id: opportunityId, label: '当前机会的笔试复盘' },
        targetOptions: [],
        missingArguments: ['reviewNote'],
        values: { mode: 'append' },
      },
    },
  })
  assert.equal(inputRequest?.presentation.kind, 'review_input')

  const confirmation = readToolConfirmationRequest(
    createConfirmationEvent({
      kind: 'review_save',
      sourceType: 'written_test',
      sourceLabel: '笔试复盘',
      title: '保存笔试复盘',
      opportunityId,
      company: '微派',
      jobTitle: '前端开发工程师',
      target: { type: 'opportunity', id: opportunityId, label: '当前机会的笔试复盘' },
      occurredAt: null,
      reviewNote: '算法题时间不够。',
      mode: 'append',
      replacingExisting: false,
      result: null,
      completesPlannedRound: false,
    }),
  )
  assert.equal(confirmation?.presentation.kind, 'review_save')
})
