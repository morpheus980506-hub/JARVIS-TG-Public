import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { app } from 'electron'
import { defaultWorkspaceId, type Attachment, type Workspace } from '../shared'
import { approve, cancel, isRunning, runAgent } from './agent'
import { attachmentStore } from './attachments'
import { dataPath } from './data-directory'
import { rememberModelCatalog } from './model-context'
import {
  addWorkspace,
  deleteSession,
  put,
  redact,
  removeWorkspace,
  saveSession,
  secret,
  secretNames,
  session,
  setSecret,
  settings,
} from './store'
export async function functionalCheck() {
  const report: {
    at: string
    checks: Record<string, any>
  } = {
    at: new Date().toISOString(),
    checks: {},
  }
  const original = settings().profile
  const originalKey = secret('deepseek')
  const ids: string[] = []
  let scenario = 'normal'
  let turns = 0
  let wireRequest: any
  let titleRequests = 0
  let unexpectedNonStreaming = 0
  const check = async (name: string, fn: () => Promise<any>) => {
    try {
      report.checks[name] = {
        ok: true,
        result: await fn(),
      }
    } catch (error: any) {
      report.checks[name] = {
        ok: false,
        error: redact(error.message),
      }
    }
    console.log(`${name}: ${report.checks[name].ok ? 'PASS' : 'FAIL'}`)
  }
  const server = http.createServer(async (req, res) => {
    let source = ''
    for await (const bytes of req) {
      source += bytes
    }
    const body = JSON.parse(source)
    if (
      req.url !== '/anthropic/v1/messages' ||
      (req.headers['x-api-key'] !== 'local-qa-placeholder' &&
        req.headers.authorization !== 'Bearer local-qa-placeholder')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Messages 请求路径或认证错误' },
        }),
      )
      return
    }
    if (body.stream) wireRequest = body
    const review = JSON.stringify(body.system || '').includes('独立的命令风险审查员')
    if (!body.stream) {
      if (!review) {
        unexpectedNonStreaming++
        res.writeHead(400).end()
        return
      }
      const decision = ['approve', 'deny'].includes(scenario) ? 'require_approval' : 'allow'
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          id: 'qa-review',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ decision, reason: '本地功能检查中的模拟审查结果' }),
            },
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      )
      return
    }
    if (body.title?.enabled === true) titleRequests++
    const previous = body.messages.findLast((message: any) => message.role === 'assistant')
    const thinking = previous?.content?.find((block: any) => block.type === 'thinking')
    if (
      thinking &&
      (thinking.thinking !== '仅供协议回传检查的思考内容 [已隐藏密钥]' ||
        thinking.signature !== 'qa-signature')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: '思考块或签名未完整回传' },
        }),
      )
      return
    }
    turns++
    const last = body.messages.at(-1)
    let name = 'run_command'
    let args: any = {
      command: "[Console]::Write('QA_COMMAND_OK')",
      explanation: '仅输出检查标记，不修改文件',
      timeoutMs: 10_000,
    }
    if (scenario === 'cancel') {
      args = {
        command: 'Start-Sleep -Seconds 30',
        explanation: '检查停止执行',
        timeoutMs: 60000,
      }
    }
    if (scenario === 'exit_error') {
      args = {
        command: "[Console]::Error.Write('QA_FAILURE');exit 7",
        explanation: '检查非零退出码',
        timeoutMs: 10000,
      }
    }
    if (scenario === 'timeout') {
      args = {
        command: 'Start-Sleep -Seconds 30',
        explanation: '检查命令超时',
        timeoutMs: 1000,
      }
    }
    if (scenario === 'tool_error') {
      name = 'read_file'
      args = {
        path: dataPath(`qa-does-not-exist-${Date.now()}`),
      }
    }
    if (scenario === 'long_loop' || scenario === 'workspace') {
      name = 'list_files'
      args = {
        path: '.',
      }
    }
    if (scenario === 'clarify') {
      name = 'ask_user'
      args = {
        questions: [
          {
            question: '你想去哪里？',
            options: [{ label: '杭州', description: '可以游览西湖', recommended: true }, '南京'],
          },
          { question: '哪一天出发？' },
        ],
      }
    }
    const call =
      scenario !== 'final' &&
      scenario !== 'cancel_reply' &&
      (scenario === 'long_loop'
        ? turns <= 31
        : !last.content?.some?.((block: any) => block.type === 'tool_result'))
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
    })
    const event = (type: string, value: Record<string, unknown>) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
    event('message_start', {
      message: {
        id: 'qa-' + turns,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, cache_read_input_tokens: 12, output_tokens: 0 },
      },
    })
    let index = 0
    if (body.thinking?.type !== 'disabled') {
      event('content_block_start', {
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      })
      for (const thinkingDelta of ['仅供协议回传检查的思考内容 local-qa-', 'placeholder']) {
        event('content_block_delta', {
          index,
          delta: { type: 'thinking_delta', thinking: thinkingDelta },
        })
      }
      event('content_block_delta', {
        index,
        delta: { type: 'signature_delta', signature: 'qa-signature' },
      })
      event('content_block_stop', { index: index++ })
    }
    event('content_block_start', { index, content_block: { type: 'text', text: '' } })
    event('content_block_delta', {
      index,
      delta: { type: 'text_delta', text: call ? '正在检查工作区。' : '功能检查完成。' },
    })
    if (scenario === 'cancel_reply') return
    event('content_block_stop', { index: index++ })
    if (call) {
      event('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: 'qa-call-' + turns, name, input: {} },
      })
      const json = JSON.stringify(args)
      const middle = Math.floor(json.length / 2)
      for (const partial_json of [json.slice(0, middle), json.slice(middle)]) {
        event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json } })
      }
      event('content_block_stop', { index })
      if (scenario === 'clarify') {
        event('content_block_start', {
          index: ++index,
          content_block: { type: 'tool_use', id: 'qa-batched-tool', name: 'list_files', input: {} },
        })
        event('content_block_delta', {
          index,
          delta: { type: 'input_json_delta', partial_json: '{"path":"."}' },
        })
        event('content_block_stop', { index })
      }
    }
    event('message_delta', {
      delta: {
        stop_reason: call ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        ...(body.title?.enabled && scenario === 'normal' && { title: '  模拟旅行标题  ' }),
      },
      usage: { input_tokens: 12_000, cache_read_input_tokens: 6_000, output_tokens: 750 },
    })
    event('message_stop', {})
    res.end()
  })
  await new Promise<void>((result) => server.listen(0, '127.0.0.1', result))
  async function run(
    mode: string,
    attachments: Attachment[] = [],
    titleManual = false,
    workspace?: Workspace,
  ) {
    scenario = mode
    turns = 0
    const id = crypto.randomUUID()
    ids.push(id)
    saveSession({
      history: [],
      id,
      workspace,
      messages: [],
      title: titleManual ? '手动标题' : '新对话',
      titleManual,
      updatedAt: Date.now(),
    })
    const events: any[] = []
    const begin = Date.now()
    await runAgent(
      id,
      '仅执行本地自动化功能检查。',
      (event) => {
        events.push(event)
        if (mode === 'cancel_reply' && event.type === 'delta') cancel(id)
        if (event.type === 'approval') {
          queueMicrotask(() => approve(event.approval!.id, mode === 'approve'))
        }
        if (
          mode === 'cancel' &&
          event.trace?.name === 'run_command' &&
          event.trace.state === 'running'
        ) {
          setTimeout(() => cancel(id), 150)
        }
      },
      undefined,
      attachments,
    )
    const failure = events.find((event) => event.type === 'error')
    if (failure && mode !== 'cancel') throw new Error(failure.text)
    return {
      elapsed: Date.now() - begin,
      events,
      id,
      trace: session(id)
        .messages.flatMap((message) => message.traces || [])
        .at(-1),
    }
  }
  try {
    await Promise.all(
      secretNames.map((name) => setSecret(name, name === 'deepseek' ? 'local-qa-placeholder' : '')),
    )
    put('profile', {
      baseURL: `http://127.0.0.1:${(server.address() as any).port}/anthropic`,
      headers: {},
      model: 'qa',
      protocol: 'messages',
    })
    rememberModelCatalog(settings().profile, [
      {
        id: 'qa',
        name: 'QA',
        contextWindow: 128_000,
        inputModalities: ['text', 'image'],
        effort: { supportedLevels: ['high'] },
      },
    ])
    await check('clarification_pauses_and_resumes', async () => {
      const result = await run('clarify')
      assert.equal(turns, 1)
      assert.equal(isRunning(result.id), false)
      const message = session(result.id).messages.at(-1)!
      assert.deepEqual(message.clarification?.questions, [
        {
          question: '你想去哪里？',
          options: [{ label: '杭州', description: '可以游览西湖', recommended: true }, '南京'],
        },
        { question: '哪一天出发？' },
      ])
      assert.equal(message.traces?.find((trace) => trace.name === 'ask_user')?.state, 'done')
      const skipped = message.traces?.find((trace) => trace.name === 'list_files')
      assert.equal(skipped?.state, 'error')
      assert.match(skipped?.output.error, /未执行/)
      scenario = 'final'
      await runAgent(result.id, '杭州，周六出发', () => {}, undefined, [], message.id)
      assert.equal(turns, 2)
      assert.ok(JSON.stringify(wireRequest.messages.at(-1)).includes('杭州，周六出发'))
      assert.equal(session(result.id).messages.at(-2)?.clarificationReplyTo, message.id)
      assert.ok(JSON.stringify(wireRequest.messages).includes('awaiting_user_reply'))
      assert.match(session(result.id).messages.at(-1)!.content, /功能检查完成/)
      return { waitedForUser: true, skippedSiblingTool: true, resumed: true }
    })
    await check('deepseek_native_conversation_title', async () => {
      titleRequests = 0
      const result = await run('normal')
      assert.equal(titleRequests, 1)
      assert.equal(session(result.id).title, '模拟旅行标题')
      await runAgent(result.id, '继续本地检查', () => {})
      assert.equal(titleRequests, 1)
      assert.equal(session(result.id).title, '模拟旅行标题')
      const fallback = await run('final')
      assert.equal(titleRequests, 2)
      assert.equal(session(fallback.id).title, '仅执行本地自动化功能检查。')
      const manual = await run('final', [], true)
      assert.equal(titleRequests, 2)
      assert.equal(session(manual.id).title, '手动标题')
      assert.equal(unexpectedNonStreaming, 0)
      return { firstRequestOnly: true, fallbackPreserved: true, manualTitlePreserved: true }
    })
    await check('command_automatic_review', async () => {
      const result = await run('normal')
      assert.equal(result.trace?.state, 'done')
      assert.equal(result.trace?.output.stdout, 'QA_COMMAND_OK')
      const saved = session(result.id).messages.at(-1)!
      assert.ok(saved.processNotes?.includes('正在检查工作区。'))
      assert.ok(!saved.content.includes('正在检查工作区。'))
      assert.ok(saved.completedAt! >= saved.startedAt!)
      assert.ok(result.events.some((event) => event.trace?.state === 'reviewing'))
      assert.ok(!result.events.some((event) => event.type === 'approval'))
      return {
        exitCode: result.trace?.output.exitCode,
      }
    })
    await check('command_human_approve', async () => {
      const result = await run('approve')
      assert.ok(result.events.some((event) => event.type === 'approval'))
      assert.equal(result.trace?.output.stdout, 'QA_COMMAND_OK')
      return {
        approved: true,
      }
    })
    await check('command_human_deny', async () => {
      const result = await run('deny')
      assert.ok(result.events.some((event) => event.type === 'approval'))
      assert.equal(result.trace?.state, 'error')
      assert.match(result.trace?.output.error, /拒绝/)
      assert.equal(result.trace?.output.stdout, undefined)
      return {
        notExecuted: true,
      }
    })
    await check('command_exit_error', async () => {
      const result = await run('exit_error')
      assert.equal(result.trace?.output.exitCode, 7)
      assert.equal(result.trace?.state, 'error')
      return {
        exitCode: 7,
      }
    })
    await check('command_timeout', async () => {
      const result = await run('timeout')
      assert.equal(result.trace?.output.timedOut, true)
      assert.equal(result.trace?.state, 'error')
      assert.ok(result.elapsed < 10_000)
      return {
        elapsedMs: result.elapsed,
      }
    })
    await check('command_cancel_and_resume', async () => {
      const result = await run('cancel')
      assert.ok(!isRunning(result.id))
      assert.ok(result.elapsed < 10_000)
      const stopped = session(result.id).messages.at(-1)
      assert.equal(stopped?.content, '已手动停止')
      assert.equal(stopped?.manuallyStopped, true)
      scenario = 'final'
      await runAgent(result.id, '继续，但不要重复之前的命令。', () => {})
      assert.ok(session(result.id).messages.at(-1)?.content.includes('功能检查完成'))
      return {
        elapsedMs: result.elapsed,
        resumed: true,
      }
    })
    await check('streamed_reply_cancel', async () => {
      const result = await run('cancel_reply')
      const reply = session(result.id).messages.at(-1)
      assert.ok(result.events.some((event) => event.type === 'delta'))
      assert.equal(result.events.at(-1)?.type, 'done')
      assert.equal(reply?.content, '已手动停止')
      assert.equal(reply?.manuallyStopped, true)
      assert.ok(reply?.completedAt)
      return { partialReplyReplaced: true }
    })
    await check('tool_failure_observation', async () => {
      const result = await run('tool_error')
      assert.equal(result.trace?.state, 'error')
      assert.ok(session(result.id).messages.at(-1)?.content.includes('功能检查完成'))
      return {
        modelContinuedAfterError: true,
      }
    })
    await check('model_continues_beyond_twenty', async () => {
      const result = await run('long_loop')
      assert.equal(turns, 32)
      assert.equal(
        session(result.id).messages.flatMap((message) => message.traces || []).length,
        31,
      )
      return {
        modelSteps: turns,
        toolCalls: 31,
      }
    })
    await check('session_workspace_survives_removal', async () => {
      const directory = await fs.mkdtemp(dataPath('qa-workspace-'))
      await fs.writeFile(path.join(directory, 'qa-workspace.txt'), '仅用于工作区检查', 'utf8')
      const workspace = await addWorkspace(directory)
      assert.equal((await addWorkspace(directory)).id, workspace.id)
      assert.throws(() => removeWorkspace(defaultWorkspaceId), /默认工作区不能移除/)
      removeWorkspace(workspace.id)
      assert.ok(!settings().workspaces.some(({ id }) => id === workspace.id))
      const result = await run('workspace', [], false, workspace)
      assert.deepEqual(session(result.id).workspace, workspace)
      assert.equal(result.trace?.output.path, workspace.path)
      assert.ok(
        result.trace?.output.entries.some(
          ({ name }: { name: string }) => name === 'qa-workspace.txt',
        ),
      )
      return { defaultProtected: true, duplicateReused: true, sessionPathPreserved: true }
    })
    await check('edit_message_regenerates', async () => {
      const result = await run('final')
      const messageId = session(result.id).messages[0].id
      await runAgent(result.id, '后续旧问题', () => {})
      await runAgent(result.id, '修改后的问题', () => {}, messageId)
      const saved = session(result.id)
      assert.equal(saved.messages.length, 2)
      assert.equal(saved.messages[0].content, '修改后的问题')
      assert.equal(saved.history.filter((message) => message.role === 'user').length, 1)
      assert.ok(!JSON.stringify(saved.history).includes('后续旧问题'))
      return { regenerated: true, staleHistoryRemoved: true }
    })
    await check('thinking_tool_roundtrip', async () => {
      const profile = settings().profile
      try {
        put('profile', { ...profile, reasoningEffort: 'high' })
        const result = await run('normal')
        assert.equal(result.trace?.state, 'done')
        assert.ok(session(result.id).messages.at(-1)?.content.includes('功能检查完成'))
        assert.ok(!session(result.id).messages.at(-1)?.content.includes('仅供协议回传检查'))
        const steps = session(result.id).messages.at(-1)?.processSteps ?? []
        const reasoning = steps.filter((step) => step.type === 'reasoning')
        assert.equal(reasoning.length, 2)
        assert.ok(reasoning.every((step) => (step.endedAt ?? 0) >= step.startedAt))
        assert.ok(steps.indexOf(reasoning[0]) < steps.findIndex((step) => step.type === 'trace'))
        const displayText = '仅供协议回传检查的思考内容 [已隐藏密钥]'
        assert.ok(reasoning.every((step) => step.text === displayText))
        assert.ok(result.events.some((event) => event.reasoning?.text === displayText))
        assert.ok(!JSON.stringify(result.events).includes('local-qa-'))
        assert.ok(!JSON.stringify(result.events).includes('qa-signature'))
        const reply = wireRequest.messages.findLast((message: any) => message.role === 'assistant')
        assert.equal(reply.content[0].type, 'thinking')
        assert.equal(reply.content[0].signature, 'qa-signature')
        assert.equal(reply.content[0].thinking, displayText)
        assert.equal(wireRequest.messages.at(-1).content[0].type, 'tool_result')
        return { thinkingAndSignaturePreserved: true }
      } finally {
        put('profile', profile)
      }
    })
    await check('thinking_request_parameters', async () => {
      const profile = settings().profile
      await run('final')
      assert.equal(wireRequest.output_config.effort, 'high')
      assert.equal(wireRequest.thinking.type, 'adaptive')
      put('profile', { ...profile, model: 'deepseek-flash', reasoningEffort: 'max' })
      await run('final')
      assert.equal(wireRequest.output_config.effort, 'max')
      assert.equal(wireRequest.reasoning_effort, undefined)
      assert.equal(wireRequest.thinking.type, 'adaptive')
      put('profile', { ...profile, model: 'deepseek-flash', reasoningEffort: 'none' })
      await run('final')
      assert.equal(wireRequest.thinking.type, 'disabled')
      assert.equal(wireRequest.reasoning_effort, undefined)
      put('profile', profile)
      return { defaultEffort: 'high', enabledEffort: 'max', disabledVerified: true }
    })
    await check('context_usage_snapshot', async () => {
      const result = await run('normal')
      const expected = {
        model: 'qa',
        inputTokens: 18_000,
        outputTokens: 750,
        cachedInputTokens: 6_000,
        contextWindow: 128_000,
      }
      const live = result.events.filter((event) => event.type === 'context-usage')
      assert.equal(live.length, 2)
      const { estimatedBreakdown, ...observed } = live.at(-1)!.contextUsage
      assert.deepEqual(observed, expected)
      assert.ok(estimatedBreakdown)
      assert.equal(
        estimatedBreakdown.systemPrompt +
          estimatedBreakdown.toolDefinitions +
          estimatedBreakdown.messages,
        expected.inputTokens + expected.outputTokens,
      )
      assert.deepEqual(session(result.id).messages.at(-1)?.contextUsage, live.at(-1)!.contextUsage)
      return { ...expected, estimatedBreakdown }
    })
    await check('attachment_messages_payload', async () => {
      const image = await attachmentStore().importFile(
        path.join(app.getAppPath(), 'assets', 'icon.png'),
      )
      const file = path.join(process.cwd(), '.local', 'qa-attachment.txt')
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, '附件测试：杭州周末旅行，预算 2000 元。')
      const text = await attachmentStore().importFile(file)
      const result = await run('final', [image, text])
      const content = wireRequest.messages.at(-1).content
      assert.ok(
        content.some(
          (block: any) =>
            block.type === 'image' &&
            block.source.media_type === 'image/png' &&
            block.source.data.length > 0,
        ),
      )
      assert.ok(
        content.some((block: any) => block.type === 'text' && block.text.includes('杭州周末旅行')),
      )
      const saved = session(result.id)
      assert.equal(saved.messages[0].attachments?.length, 2)
      assert.ok(saved.messages[0].attachments?.[0].preview)
      assert.ok(
        !JSON.stringify(saved.history).includes(
          content.find((block: any) => block.type === 'image').source.data,
        ),
      )
      return { realImageBlock: true, textFileIncluded: true, referencesPersisted: true }
    })
  } finally {
    put('profile', original)
    await setSecret('deepseek', originalKey)
    for (const id of ids) {
      deleteSession(id)
    }
    await new Promise<void>((result) => server.close(() => result()))
  }
  const target = path.join(process.cwd(), '.local', 'functional-check.json')
  await fs.mkdir(path.dirname(target), {
    recursive: true,
  })
  await fs.writeFile(target, JSON.stringify(report, undefined, 2))
  console.log(JSON.stringify(report))
  return Object.values(report.checks).some((config) => !config.ok) ? 1 : 0
}
