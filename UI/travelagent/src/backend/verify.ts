import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runAgent } from './agent'
import { dataPath } from './data-directory'
import { amap, deepseekTool, request } from './network'
import { put, saveSession, secret, session, settings } from './store'
import { readFile, writeFile } from './tools'
export async function verifyExtra() {
  const report: any = {
    at: new Date().toISOString(),
    checks: {},
  }
  const check = async (name: string, fn: () => Promise<any>) => {
    try {
      report.checks[name] = {
        ok: true,
        result: await fn(),
      }
    } catch (error: any) {
      report.checks[name] = {
        ok: false,
        error: error.message,
      }
    }
    console.log(`${name}: ${report.checks[name].ok ? 'PASS' : 'FAIL'}`)
  }
  const original = settings().profile
  try {
    for (const protocol of ['messages'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- Sequential execution preserves tool dependencies, retry order, or storage initialization.
      await check(protocol, async () => {
        put('profile', {
          ...original,
          baseURL: original.baseURL,
          protocol,
        })
        const id = crypto.randomUUID()
        saveSession({
          history: [],
          id,
          messages: [],
          title: '验证 · ' + protocol,
          updatedAt: Date.now(),
        })
        const events: any[] = []
        await runAgent(id, '请调用 list_files 查看工作区，然后简短说明成功。', (event) =>
          events.push(event),
        )
        const sessionValue = session(id)
        if (events.some((event) => event.type === 'error')) {
          throw new Error(events.find((event) => event.type === 'error').text)
        }
        if (
          !sessionValue.messages.some((message) =>
            message.traces?.some((entry) => entry.name === 'list_files' && entry.state === 'done'),
          )
        ) {
          throw new Error('没有成功的工具调用')
        }
        return {
          toolCalled: true,
        }
      })
    }
  } finally {
    put('profile', original)
  }
  await check('transit', async () => {
    const result = await amap(
      'v3/direction/transit/integrated',
      {
        city: '北京',
        cityd: '北京',
        destination: '116.404,39.883',
        extensions: 'all',
        origin: '116.411,39.915',
      },
      AbortSignal.timeout(30_000),
    )
    if (!result.route?.transits?.length) {
      throw new Error('没有公交方案')
    }
    return {
      cost: result.route.transits[0].cost,
      options: result.route.transits.length,
    }
  })
  await check('static_map', async () => {
    const params = new URLSearchParams({
      key: secret('amap'),
      location: '116.3974,39.9092',
      size: '600*450',
      zoom: '12',
    })
    const result = await fetch(`https://restapi.amap.com/v3/staticmap?${params}`)
    if (!result.ok || !result.headers.get('content-type')?.startsWith('image/')) {
      throw new Error('未返回地图图像')
    }
    return {
      bytes: (await result.arrayBuffer()).byteLength,
    }
  })
  await check('file_backup', async () => {
    const file = path.join(process.cwd(), '.local', 'verify-outside-workspace.txt')
    await fs.mkdir(path.dirname(file), {
      recursive: true,
    })
    await fs.writeFile(file, 'original', 'utf8')
    const result = await writeFile(file, 'updated')
    if (!result.backup || (await fs.readFile(result.backup, 'utf8')) !== 'original') {
      throw new Error('备份不正确')
    }
    if ((await readFile(file)).lines !== 'updated') {
      throw new Error('写入失败')
    }
    await fs.unlink(file)
    return {
      backupVerified: true,
      outsideWorkspace: true,
    }
  })
  await fs.writeFile(dataPath('verification-extra.json'), JSON.stringify(report, undefined, 2))
  console.log(JSON.stringify(report))
}
export async function verify() {
  const report: any = {
    at: new Date().toISOString(),
    checks: {},
  }
  const check = async (name: string, fn: () => Promise<any>) => {
    try {
      report.checks[name] = {
        ok: true,
        result: await fn(),
      }
    } catch (error: any) {
      report.checks[name] = {
        ok: false,
        error: error.message,
      }
    }
  }
  const signal = AbortSignal.timeout(120_000)
  await check('deepseek', async () => {
    const result = await request('https://api.deepseek.com/models', {
      headers: {
        Authorization: `Bearer ${secret('deepseek')}`,
      },
    })
    return {
      flash: result.data.some((item: any) => item.id === 'deepseek-flash'),
    }
  })
  await check('search', async () => {
    const result = await deepseekTool(
      'search',
      {
        count: 1,
        need_content: false,
        query: '故宫博物院 开放时间 site:dpm.org.cn',
      },
      signal,
    )
    return {
      results: result.results.length,
      title: result.results[0]?.title,
    }
  })
  await check('fetch', async () => {
    const result = await deepseekTool(
      'fetch',
      {
        url: 'https://api-docs.deepseek.com/zh-cn/guides/search/',
      },
      signal,
    )
    return {
      characters: result.content.length,
      title: result.title,
    }
  })
  await check('amap', async () => {
    const result = await amap(
      'v3/place/text',
      {
        city: '北京',
        keywords: '故宫博物院',
        offset: '1',
      },
      signal,
    )
    return {
      count: result.count,
      name: result.pois?.[0]?.name,
    }
  })
  await check('react', async () => {
    const id = crypto.randomUUID()
    saveSession({
      history: [],
      id,
      messages: [],
      title: '验证 · ReAct',
      updatedAt: Date.now(),
    })
    const events: any[] = []
    await runAgent(
      id,
      '这是连通验证：请调用 list_files 查看当前工作区，然后简短告诉我执行成功。不需要执行命令。',
      (event) => events.push(event),
    )
    const session2Value = session(id)
    if (events.some((event) => event.type === 'error')) {
      throw new Error(events.find((event) => event.type === 'error').text)
    }
    return {
      answer: session2Value.messages.at(-1)?.content,
      toolCalled: session2Value.messages.some((message) =>
        message.traces?.some((entry) => entry.name === 'list_files' && entry.state === 'done'),
      ),
    }
  })
  await check('command_review', async () => {
    const id = crypto.randomUUID()
    saveSession({
      history: [],
      id,
      messages: [],
      title: '验证 · 命令审查',
      updatedAt: Date.now(),
    })
    const events: any[] = []
    await runAgent(
      id,
      "执行连通测试：请使用 run_command 执行 [Console]::Write('TRAVEL_AGENT_OK')。这是只输出标记、不修改文件的命令，完成后确认。",
      (event) => events.push(event),
    )
    const session3Value = session(id)
    const entry = session3Value.messages
      .flatMap((message) => message.traces || [])
      .find((entryValue) => entryValue.name === 'run_command')
    if (!entry || entry.state !== 'done' || !entry.output?.stdout?.includes('TRAVEL_AGENT_OK')) {
      throw new Error(
        JSON.stringify(entry?.output || events.filter((event) => event.type === 'error')),
      )
    }
    return {
      exitCode: entry.output.exitCode,
      reviewed: events.some((event) => event.trace?.state === 'reviewing'),
      stdout: entry.output.stdout,
    }
  })
  await check('route', async () => {
    const result = await amap(
      'v3/direction/walking',
      {
        destination: '116.397,39.917',
        extensions: 'all',
        origin: '116.3974,39.9092',
      },
      signal,
    )
    if (!result.route?.paths?.length) {
      throw new Error('无路线')
    }
    return {
      distance: result.route.paths[0].distance,
      duration: result.route.paths[0].duration,
    }
  })
  await check('trip', async () => {
    const id = crypto.randomUUID()
    saveSession({
      history: [],
      id,
      messages: [],
      title: '验证 · 北京三日游',
      updatedAt: Date.now(),
    })
    const events: any[] = []
    await runAgent(
      id,
      '我已在北京，1名成人，2026年11月10日至12日三日游，总预算2000元，住王府井附近，喜欢历史文化，公交地铁优先，不需要查询跨城车票。请查询真实地点和市内交通，安排三日行程，通过 publish_trip 发布行程和预算；住宿餐饮门票可明确估算。',
      (event) => events.push(event),
    )
    const session4Value = session(id)
    if (!session4Value.trip || session4Value.trip.days.length !== 3) {
      throw new Error(events.find((event) => event.type === 'error')?.text || '未发布三日行程')
    }
    return {
      days: session4Value.trip.days.length,
      title: session4Value.trip.title,
      tools: [
        ...new Set(
          session4Value.messages
            .flatMap((message) => message.traces || [])
            .map((entry) => entry.name),
        ),
      ],
    }
  })
  const output = dataPath('verification.json')
  await fs.writeFile(output, JSON.stringify(report, undefined, 2))
  console.log(JSON.stringify(report))
}
