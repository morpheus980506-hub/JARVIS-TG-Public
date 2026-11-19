import type { AIMessage } from '@langchain/core/messages'
import type { AgentEvent, Trace } from '../shared'
import type { ModelMessage } from './agent-history-types'
import { parseToolInput, type AgentTool } from './agent-tools'
import { clarificationToolName } from './clarification'
import { commandWithReview } from './command-review'
import { redact, type settings } from './store'

export async function executeAgentTools(
  calls: NonNullable<AIMessage['tool_calls']>,
  context: {
    sessionId: string
    userGoal: string
    cfg: ReturnType<typeof settings> & { workspace: string }
    signal: AbortSignal
    tools: Record<string, AgentTool>
    history: ModelMessage[]
    trace: (entry: Trace) => void
    emit: (event: Omit<AgentEvent, 'sessionId'>) => void
    persist: () => void
  },
) {
  const clarification = calls.find((call) => call.name === clarificationToolName)
  let awaitingUser = false
  for (const call of calls) {
    context.signal.throwIfAborted()
    const entry: Trace = {
      id: call.id!,
      input: call.args,
      name: call.name,
      state: 'running',
    }
    context.trace(entry)
    let output: any
    try {
      if (clarification && call !== clarification) {
        output = { error: '本批次包含澄清提问，未执行此调用' }
      } else if (call.name === 'run_command') {
        // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
        output = await commandWithReview(
          call.args,
          context.sessionId,
          context.userGoal,
          context.cfg,
          context.signal,
          (state, explanation) =>
            context.trace({
              ...entry,
              explanation,
              state,
            }),
          context.emit,
        )
      } else {
        const fn = context.tools[call.name]
        if (!fn) {
          throw new Error('未知工具')
        }
        // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
        const input = await parseToolInput(fn, call.args)
        // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
        output = await fn.execute(input, {
          abortSignal: context.signal,
        })
        if (call === clarification) awaitingUser = true
      }
      const failed =
        output?.error ||
        output?.timedOut ||
        output?.cancelled ||
        (typeof output?.exitCode === 'number' && output.exitCode !== 0)
      context.trace({
        ...entry,
        output,
        state: failed ? 'error' : 'done',
      })
    } catch (error: any) {
      if (context.signal.aborted) {
        throw error
      }
      output = {
        error: redact(error.message || String(error)),
      }
      context.trace({
        ...entry,
        output,
        state: 'error',
      })
    }
    const serialized = redact(JSON.stringify(output ?? null))
    context.history.push({
      content: [
        {
          type: 'tool-result',
          toolCallId: call.id!,
          toolName: call.name,
          output: {
            type: 'text',
            value: serialized,
          },
        },
      ],
      role: 'tool',
    })
    context.persist()
  }
  return awaitingUser
}
