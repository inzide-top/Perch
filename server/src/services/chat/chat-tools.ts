import { AgentToolRegistry } from './agent-tool'
import {
  createGetActionStrategyTool,
  createGetCapabilityProfileTool,
  createGetOpportunityContextTool,
  createImportOpportunitiesFromUrlsTool,
  createImportOpportunityFromTextTool,
  createSearchOpportunitiesTool,
  type ChatToolRegistryDependencies,
  type CreateChatToolRegistryInput,
} from './chat-tools/read-tools'
import {
  createBatchUpdateOpportunityProfilesTool,
  createGlobalUpdateOpportunityProfileTool,
  createLegacyUpdateOpportunityIntentionTool,
  createUpdateOpportunityProfileTool,
} from './chat-tools/profile-tools'
import {
  createGlobalTransitionOpportunityStatusTool,
  createTransitionOpportunityStatusTool,
} from './chat-tools/status-tools'
import { createGlobalTerminateOpportunityTool, createTerminateOpportunityTool } from './chat-tools/termination-tools'
import { createGlobalInterviewScheduleTool, createInterviewScheduleTool } from './chat-tools/interview-schedule-tools'
import { createGlobalMockInterviewTool, createMockInterviewTool } from './chat-tools/mock-interview-tools'
import {
  createGlobalInterviewReviewTool,
  createGlobalWrittenTestReviewTool,
  createInterviewReviewTool,
  createWrittenTestReviewTool,
} from './chat-tools/review-tools'

export type { ChatToolRegistryDependencies, CreateChatToolRegistryInput } from './chat-tools/read-tools'

export function createChatToolRegistry(input: CreateChatToolRegistryInput, dependencies: ChatToolRegistryDependencies) {
  if (input.scopeType === 'opportunity') {
    if (!input.opportunity) return new AgentToolRegistry([])
    if (!dependencies.updateOpportunityProfileForUser) {
      throw new Error('机会修改工具缺少数据库写入依赖')
    }
    const definitions = [
      createUpdateOpportunityProfileTool(input.userId, input.opportunity, dependencies.updateOpportunityProfileForUser),
      createLegacyUpdateOpportunityIntentionTool(
        input.userId,
        input.opportunity,
        dependencies.updateOpportunityProfileForUser,
      ),
    ]
    if (input.opportunity.status !== 'closed') {
      if (!dependencies.transitionOpportunityStatusForUser) throw new Error('机会状态流转工具缺少数据库写入依赖')
      definitions.push(
        createTransitionOpportunityStatusTool(
          input.userId,
          input.opportunity,
          dependencies.transitionOpportunityStatusForUser,
        ),
      )
      if (dependencies.terminateOpportunityForUser) {
        definitions.push(
          createTerminateOpportunityTool(input.userId, input.opportunity, dependencies.terminateOpportunityForUser),
        )
      }
    }
    if (input.opportunity.status === 'interviewing') {
      if (!dependencies.createInterviewScheduleForUser) throw new Error('创建面试安排工具缺少数据库写入依赖')
      definitions.push(
        createInterviewScheduleTool(input.userId, input.opportunity, dependencies.createInterviewScheduleForUser),
      )
    }
    if (dependencies.createMockInterviewForUser) {
      definitions.push(
        createMockInterviewTool(input.userId, input.opportunity, dependencies.createMockInterviewForUser),
      )
    }
    if (input.opportunity.includeWrittenTest) {
      if (!dependencies.saveWrittenTestReviewForUser) throw new Error('笔试复盘工具缺少数据库写入依赖')
      definitions.push(
        createWrittenTestReviewTool(input.userId, input.opportunity, dependencies.saveWrittenTestReviewForUser),
      )
    }
    if (Boolean(dependencies.findInterviewRoundsByOpportunityId) !== Boolean(dependencies.saveInterviewReviewForUser)) {
      throw new Error('面试复盘工具缺少轮次查询或数据库写入依赖')
    }
    if (dependencies.findInterviewRoundsByOpportunityId && dependencies.saveInterviewReviewForUser) {
      definitions.push(
        createInterviewReviewTool(
          input.userId,
          input.opportunity,
          dependencies.findInterviewRoundsByOpportunityId,
          dependencies.saveInterviewReviewForUser,
        ),
      )
    }
    return new AgentToolRegistry(definitions)
  }

  const definitions = [createSearchOpportunitiesTool(input.userId, dependencies.findOpportunitiesByUserId)]
  if (dependencies.getOpportunityContextForUser) {
    definitions.push(
      createGetOpportunityContextTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.getOpportunityContextForUser,
      ),
    )
  }
  if (Boolean(dependencies.findResumesByUserId) !== Boolean(dependencies.getCapabilityProfileForUser)) {
    throw new Error('能力画像工具缺少简历查询或画像聚合依赖')
  }
  if (dependencies.findResumesByUserId && dependencies.getCapabilityProfileForUser) {
    definitions.push(
      createGetCapabilityProfileTool(
        input.userId,
        dependencies.findResumesByUserId,
        dependencies.getCapabilityProfileForUser,
      ),
    )
  }
  if (dependencies.getActionStrategyOverviewForUser) {
    definitions.push(createGetActionStrategyTool(input.userId, dependencies.getActionStrategyOverviewForUser))
  }
  if (dependencies.importOpportunitiesFromUrls) {
    definitions.push(createImportOpportunitiesFromUrlsTool(dependencies.importOpportunitiesFromUrls))
  }
  if (dependencies.importOpportunityFromText) {
    definitions.push(createImportOpportunityFromTextTool(dependencies.importOpportunityFromText))
  }
  if (dependencies.updateOpportunityProfileForUser) {
    definitions.push(
      createGlobalUpdateOpportunityProfileTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.updateOpportunityProfileForUser,
      ),
    )
    if (dependencies.batchUpdateOpportunityProfilesForUser) {
      definitions.push(
        createBatchUpdateOpportunityProfilesTool(
          input.userId,
          dependencies.findOpportunitiesByUserId,
          dependencies.updateOpportunityProfileForUser,
          dependencies.batchUpdateOpportunityProfilesForUser,
        ),
      )
    }
  }
  if (dependencies.transitionOpportunityStatusForUser) {
    definitions.push(
      createGlobalTransitionOpportunityStatusTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.transitionOpportunityStatusForUser,
      ),
    )
  }
  if (dependencies.terminateOpportunityForUser) {
    definitions.push(
      createGlobalTerminateOpportunityTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.terminateOpportunityForUser,
      ),
    )
  }
  if (dependencies.createInterviewScheduleForUser) {
    definitions.push(
      createGlobalInterviewScheduleTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.createInterviewScheduleForUser,
      ),
    )
  }
  if (dependencies.createMockInterviewForUser) {
    definitions.push(
      createGlobalMockInterviewTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.createMockInterviewForUser,
      ),
    )
  }
  if (dependencies.saveWrittenTestReviewForUser) {
    definitions.push(
      createGlobalWrittenTestReviewTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.saveWrittenTestReviewForUser,
      ),
    )
  }
  if (Boolean(dependencies.findInterviewRoundsByOpportunityId) !== Boolean(dependencies.saveInterviewReviewForUser)) {
    throw new Error('全局面试复盘工具缺少轮次查询或数据库写入依赖')
  }
  if (dependencies.findInterviewRoundsByOpportunityId && dependencies.saveInterviewReviewForUser) {
    definitions.push(
      createGlobalInterviewReviewTool(
        input.userId,
        dependencies.findOpportunitiesByUserId,
        dependencies.findInterviewRoundsByOpportunityId,
        dependencies.saveInterviewReviewForUser,
      ),
    )
  }
  return new AgentToolRegistry(definitions)
}
