import { z } from 'zod'
import type { Clarification } from '../shared'
import { defineTool } from './agent-tools'

export const clarificationToolName = 'ask_user'

const label = z.string().trim().min(1).max(80)
const option = z.union([
  label,
  z.object({
    label,
    description: z.string().trim().min(1).max(160).optional(),
    recommended: z.boolean().optional(),
  }),
])

export function buildClarificationTool(ask: (clarification: Clarification) => void) {
  return defineTool({
    description:
      '在用户的目标或关键条件不明确、不同答案会改变结果时询问用户。合并本轮最关键的 1 至 3 个问题。每题可不提供选项，或提供最多 4 个简短的预设选项，可附区别说明；有充分依据时，每题最多标记 1 个推荐项。自由回答和跳过由界面提供，不计入预设选项。跳过的条件保持未知，先继续能完成的部分，不立即重复询问。此调用结束本轮，等待下一条用户消息，不要与其他工具一起调用。',
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            question: z.string().trim().min(1).max(200),
            options: z
              .array(option)
              .max(4)
              .refine(
                (options) =>
                  new Set(options.map((item) => (typeof item === 'string' ? item : item.label)))
                    .size === options.length,
                '选项不能重复',
              )
              .refine(
                (options) =>
                  options.filter((item) => typeof item !== 'string' && item.recommended).length <=
                  1,
                '最多一个推荐项',
              )
              .optional(),
          }),
        )
        .min(1)
        .max(3)
        .refine(
          (questions) => new Set(questions.map((item) => item.question)).size === questions.length,
          '问题不能重复',
        ),
    }),
    execute(input) {
      ask(input)
      return { status: 'awaiting_user_reply' }
    },
  })
}
