import crypto from 'node:crypto'
import { AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { estimateContextBreakdown } from '../context-usage'
import { beforeEditedMessage } from '../conversation'
import { recordReasoningStep } from '../process-steps'
import type { ReasoningStep } from '../shared'
import { AgentEvent, Message, Trace, type Attachment, type Clarification } from '../shared'
import { contextSize, createContextManager } from './agent-context'
import { executeAgentTools } from './agent-execution'
import { runAgentGraph } from './agent-graph'
import type { ModelMessage } from './agent-history-types'
import { fromAIMessage } from './agent-messages'
import { agentSystem, summarySystem } from './agent-prompts'
import { validateModelResponse } from './agent-stream'
import { toolSchemaSize, bindAgentTools } from './agent-tools'
import { modelMessages } from './attachments'
import { buildClarificationTool, clarificationToolName } from './clarification'
import { cancelApprovals } from './command-review'
import { createDeepSeekModel, deepSeekTokenUsage } from './deepseek-model'
import { repairInterruptedCalls } from './history'
import { buildMcpTools } from './mcp'
import { knownContextWindow, modelContextWindow, modelAcceptsImages } from './model-context'
import { redactData, streamRedactor } from './redaction'
import {
  defaultWorkspace,
  redact,
  saveSession,
  secret,
  secretValues,
  session,
  settings,
} from './store'
import { buildTools } from './tools'
import { observedTrip } from './trip'
export { approve } from './command-review'
const active = new Map<string, AbortController>()
const manualStopText = '已手动停止'
function noMcpCleanup() {}
function publishReasoning(
  assistant: Message,
  emit: (event: Omit<AgentEvent, 'sessionId'>) => void,
  step: ReasoningStep,
) {
  assistant.processSteps = recordReasoningStep(assistant.processSteps ?? [], step)
  emit({ type: 'reasoning', reasoning: step })
}
export function cancel(id: string) {
  active.get(id)?.abort()
  cancelApprovals(id)
}
export function isRunning(id: string) {
  return active.has(id)
}

export async function runAgent(
  id: string,
  text: string,
  send: (e: AgentEvent) => void,
  editMessageId?: string,
  attachments: Attachment[] = [],
  clarificationReplyTo?: string,
) {
  if (active.has(id)) {
    throw new Error('该会话仍在执行')
  }
  const original = session(id)
  const sessionValue = editMessageId ? beforeEditedMessage(original, editMessageId) : original
  const persist = () => {
    const latest = session(id)
    if (latest.titleManual) {
      sessionValue.title = latest.title
      sessionValue.titleManual = true
    }
    sessionValue.hotelBudget = latest.hotelBudget
    saveSession(sessionValue)
  }
  const cfg = { ...settings(), workspace: (sessionValue.workspace ?? defaultWorkspace()).path }
  const controller = new AbortController()
  active.set(id, controller)
  const { signal } = controller
  const user = {
    content: text,
    id: crypto.randomUUID(),
    role: 'user' as const,
    attachments,
    clarificationReplyTo,
  }
  const assistant: Message & { traces: Trace[]; processNotes: string[] } = {
    content: '',
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    traces: [] as Trace[],
    processNotes: [] as string[],
    processSteps: [],
    startedAt: Date.now(),
    completedAt: undefined as number | undefined,
  }
  const firstTurn = original.messages.length === 0
  sessionValue.messages.push(user, assistant)
  if (!sessionValue.titleManual && sessionValue.title === '新对话') {
    sessionValue.title = (text || attachments[0]?.name || '新对话').slice(0, 26)
  }
  persist()
  const emit = (event: Omit<AgentEvent, 'sessionId'>) =>
    send({
      ...event,
      sessionId: id,
    })
  emit({
    type: 'start',
    startedMessages: {
      userId: user.id,
      assistantId: assistant.id,
      startedAt: assistant.startedAt!,
    },
  })
  const append = (chunk: string) => {
    assistant.content += chunk
    if (chunk) emit({ text: chunk, type: 'delta' })
  }
  const addProcessNote = (note: string) => {
    if (!note.trim()) return
    assistant.processNotes.push(note)
    assistant.processSteps!.push({ type: 'note', text: note })
    emit({ type: 'progress', text: note })
  }
  const history: ModelMessage[] = repairInterruptedCalls(sessionValue.history || [])
  history.push({
    content: text,
    role: 'user',
    attachments,
  })
  const trace = (entry: Trace) => {
    const safe = JSON.parse(redact(JSON.stringify(entry)))
    const index = assistant.traces.findIndex((item) => item.id === entry.id)
    if (index === -1) {
      assistant.traces.push(safe)
      assistant.processSteps!.push({ type: 'trace', traceId: entry.id })
    } else {
      assistant.traces[index] = safe
    }
    persist()
    emit({
      trace: safe,
      type: 'trace',
    })
  }
  let closeMcp: () => void | Promise<void> = noMcpCleanup
  try {
    const key = secret('deepseek')
    const mainModel = createDeepSeekModel(cfg.profile, key)
    const tools = buildTools({
      workspace: cfg.workspace,
      hotelUpdate: (lookup) => {
        const hotelLookup = redactData(lookup, secretValues())
        const prior = assistant.hotelLookups ?? []
        const index = prior.findIndex((entry) => entry.id === hotelLookup.id)
        assistant.hotelLookups =
          index === -1
            ? [...prior, hotelLookup]
            : prior.map((entry, at) => (at === index ? hotelLookup : entry))
        persist()
        emit({ type: 'hotels', messageId: assistant.id, hotelLookup })
      },
      command: async () => {
        throw new Error('由主调度器执行')
      },
      publish: async (trip) => {
        sessionValue.trip = observedTrip(trip, sessionValue.messages)
        persist()
        emit({
          type: 'trip',
          trip: sessionValue.trip,
        })
        return {
          saved: true,
        }
      },
      signal,
    })
    const mcp = await buildMcpTools(signal)
    closeMcp = mcp.close
    let pendingClarification: Clarification | undefined
    const allTools = {
      ...tools,
      ...mcp.tools,
      [clarificationToolName]: buildClarificationTool((clarification) => {
        pendingClarification = redactData(clarification, secretValues())
      }),
    }
    if (mcp.failures.length) {
      addProcessNote(`MCP 服务未连接：${mcp.failures.join('；')}`)
    }
    const system = agentSystem(cfg.workspace)
    const systemSize = Buffer.byteLength(system, 'utf8')
    const toolsSize = toolSchemaSize(allTools)
    const modelTools = bindAgentTools(allTools)
    const boundModel = mainModel.bindTools(modelTools)
    let requestTitle = firstTurn && !sessionValue.titleManual
    const context = createContextManager({
      contextWindow: modelContextWindow(cfg.profile),
      overhead: toolsSize + systemSize,
      summarize: async (source) => {
        const result = await mainModel.invoke(
          [new SystemMessage(summarySystem), new HumanMessage(source)],
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          },
        )
        return redact(result.text)
      },
    })
    await runAgentGraph({
      signal,
      model: async () => {
        const messages = await context.prepare(redactData(history, secretValues()))
        if (
          modelAcceptsImages(cfg.profile) === false &&
          messages.some(
            (message) =>
              message.role === 'user' &&
              message.attachments?.some((item) => item.mimeType.startsWith('image/')),
          )
        )
          throw new Error('当前模型不支持图片，请切换为支持图片的模型后重新发送')
        const withTitle = requestTitle && !session(id).titleManual
        requestTitle = false
        const model = withTitle
          ? createDeepSeekModel(cfg.profile, key, true).bindTools(modelTools)
          : boundModel
        const response = await model.stream(
          [new SystemMessage(system), ...(await modelMessages(messages))],
          { signal },
        )
        const secrets = secretValues()
        const safeDelta = streamRedactor(secrets)
        let safeThinking = streamRedactor(secrets)
        let result = new AIMessageChunk({ content: '' })
        let title = ''
        let reasoning: ReasoningStep | undefined
        const endReasoning = () => {
          if (!reasoning) return
          publishReasoning(assistant, emit, {
            ...reasoning,
            text: (reasoning.text ?? '') + safeThinking('', true),
            endedAt: Date.now(),
          })
          reasoning = undefined
          safeThinking = streamRedactor(secrets)
        }
        try {
          for await (const chunk of response) {
            const thinkingBlocks = Array.isArray(chunk.content)
              ? chunk.content.filter(
                  (block) => block.type === 'thinking' || block.type === 'redacted_thinking',
                )
              : []
            if (thinkingBlocks.length) {
              const delta = safeThinking(
                thinkingBlocks
                  .map((block) =>
                    block.type === 'thinking' && typeof block.thinking === 'string'
                      ? block.thinking
                      : '',
                  )
                  .join(''),
              )
              if (!reasoning) {
                reasoning = {
                  type: 'reasoning',
                  id: crypto.randomUUID(),
                  startedAt: Date.now(),
                  text: delta,
                }
                publishReasoning(assistant, emit, reasoning)
              } else if (delta) {
                reasoning = { ...reasoning, text: (reasoning.text ?? '') + delta }
                publishReasoning(assistant, emit, reasoning)
              }
            } else if (
              chunk.text ||
              chunk.tool_call_chunks?.length ||
              chunk.additional_kwargs.stop_reason
            ) {
              endReasoning()
            }
            // ChatAnthropic forwards the Messages message_delta fields as additional_kwargs.
            const candidate = chunk.additional_kwargs.title
            if (withTitle && typeof candidate === 'string' && candidate.trim()) title = candidate
            result = result.concat(chunk)
            append(safeDelta(chunk.text))
          }
        } finally {
          endReasoning()
        }
        append(safeDelta('', true))
        signal.throwIfAborted()
        validateModelResponse(result)
        const usage = deepSeekTokenUsage(
          result.additional_kwargs.deepseekUsage,
          result.usage_metadata,
        )
        if (usage && usage.inputTokens > 0) {
          assistant.contextUsage = {
            model: cfg.profile.model,
            ...usage,
            contextWindow: knownContextWindow(cfg.profile),
            estimatedBreakdown: estimateContextBreakdown(usage.inputTokens, usage.outputTokens, {
              systemPrompt: systemSize,
              toolDefinitions: toolsSize,
              messages: contextSize(messages),
            }),
          }
          emit({ type: 'context-usage', contextUsage: assistant.contextUsage })
        }
        if (title) {
          const safeTitle = redact(title).trim().replace(/\s+/g, ' ').slice(0, 40)
          if (safeTitle) sessionValue.title = safeTitle
        }
        history.push(fromAIMessage(result))
        sessionValue.history = history
        persist()
        return result
      },
      tools: async (response) => {
        const calls = response.tool_calls || []
        if (assistant.content.trim()) {
          const note = assistant.content
          assistant.content = ''
          addProcessNote(note)
        }
        return executeAgentTools(calls, {
          sessionId: id,
          userGoal: text,
          cfg,
          signal,
          tools: allTools,
          history,
          trace,
          emit,
          persist: () => {
            sessionValue.history = history
            persist()
          },
        })
      },
    })
    signal.throwIfAborted()
    assistant.clarification = pendingClarification
  } catch (error: any) {
    const errorText = signal.aborted ? manualStopText : redact(error.message || String(error))
    for (const pending of assistant.traces.filter(
      (entry) => !['done', 'error'].includes(entry.state),
    )) {
      trace({
        ...pending,
        state: 'error',
        output: {
          error: errorText,
        },
      })
    }
    if (!signal.aborted) {
      assistant.content += (assistant.content ? '\n\n' : '') + errorText
      emit({ text: errorText, type: 'error' })
    }
  } finally {
    await closeMcp()
    if (signal.aborted) {
      assistant.manuallyStopped = true
      assistant.content = manualStopText
      assistant.clarification = undefined
    }
    assistant.completedAt = Date.now()
    const latest = session(id)
    if (latest.titleManual) {
      sessionValue.title = latest.title
      sessionValue.titleManual = true
    }
    sessionValue.history = repairInterruptedCalls(history)
    sessionValue.messages = sessionValue.messages.map((message) =>
      Object.assign(message, {
        content: redact(message.content),
      }),
    )
    persist()
    active.delete(id)
    cancelApprovals(id)
    emit({
      type: 'done',
    })
  }
}
