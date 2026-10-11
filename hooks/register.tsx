import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BgAgent, Role } from '../types'

// 開發分工（F:\Docker\docs\開發分工.md）的程式版：
//  ① 派工守門＝G16：背景窗不得再派子代理；主窗派會繼承主模型的內建型別必須寫 model。
//  ② 認窗：看到「你是 <專案> <窗>」（或 /認窗，指令本體在 commands/認窗.md）就記下角色，狀態列顯示角色與模型，
//     模型不符角色表時提醒。
//  ③ 背景窗監控：143H 有一窗卡在背景腳本 43 分鐘、780K tokens、零產出，PM 手動才發現。
//     記每個派出去的背景窗；超過 IDLE_MIN 分鐘沒有任何工具動作就提醒一次；/背景窗 列清單並開面板。

// ---------- ② 認窗 ----------
const CARDS = 'F:\\Docker\\docs\\職務卡\\'
const WINDOWS: Record<string, { card: string; expect: string }> = {
  思考: { card: '思考窗', expect: 'fable' },
  PM: { card: 'PM', expect: 'opus' },
  規格: { card: 'PM', expect: 'opus' },
  設計: { card: '設計窗', expect: 'opus' },
  總設計: { card: '總設計窗', expect: 'fable' },
  AI調整: { card: 'AI調整窗', expect: 'opus' },
  蒐集資料: { card: '蒐集資料窗', expect: 'sonnet' },
  後端: { card: '後端窗', expect: 'opus' },
  前端: { card: '前端窗', expect: 'opus' },
  功能驗收: { card: '功能驗收窗', expect: 'haiku' },
  視覺驗收: { card: '視覺驗收窗', expect: 'opus' },
}
const SAYS = /^\s*(?:\/(?:dev-roles:)?認窗|你是)\s*(\S+)\s+(\S+?)(?:窗)?\s*[。．.]?\s*$/m
const role = atom({ plugin: 'dev-roles', key: 'role' } as const, null as Role | null)
const statusOf = (r: Role, model: string) =>
  `${r.project}-${r.window} · ${model}` + (model.toLowerCase().includes(r.expect) ? '' : ` ⚠ 角色表：${r.expect}`)

// ---------- ① 派工守門 ----------
const INHERITS = new Set(['general-purpose', 'Explore', 'Plan', 'claude'])
const OVERRIDE = '[G16-OK]'

// ---------- ③ 背景窗監控 ----------
const IDLE_MIN = 15
const PANE = 'dev-roles-bg'
const bg = atom({ plugin: 'dev-roles', key: 'bg' } as const, [] as BgAgent[])
const live = new Map<string, BgAgent>() // 事件即時更新；每 30 秒同步進 atom（面板讀 atom）
const warned = new Set<string>()
const snap = () => [...live.values()].slice(-30).map(a => ({ ...a }))
const mins = (ms: number) => Math.round(ms / 60000)
const kilo = (n?: number) => (n === undefined ? '—' : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))
const lineOf = (a: BgAgent, now: number) => {
  const run = a.status === 'running'
  const idle = run ? mins(now - a.last) : 0
  const flag = run ? (idle >= IDLE_MIN ? '⚠' : '▶') : a.status === 'done' ? '✔' : '✘'
  return `${flag} ${a.desc}｜${a.model}｜${mins((a.end ?? now) - a.start)} 分｜工具 ${a.tools}｜${run ? `閒置 ${idle} 分` : `tokens ${kilo(a.tokens)}`}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: '背景窗', description: '列出這個 session 派出去的背景窗（模型、耗時、工具次數、閒置、tokens）' })
    const r = await read($, role)
    if (r) $.ui.status(statusOf(r, await $.session.model()))
    for (const a of await read($, bg)) live.set(a.id, a) // 重載後接回
    $.clock.every(30000, async () => {
      const now = Date.now()
      for (const a of live.values()) {
        if (a.status !== 'running' || warned.has(a.id) || now - a.last < IDLE_MIN * 60000) continue
        warned.add(a.id)
        $.ui.toast(`⚠ 背景窗「${a.desc}」${mins(now - a.last)} 分鐘沒有動作（${a.model}，已 ${mins(now - a.start)} 分）`)
      }
      await update($, bg, snap)
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const m = SAYS.exec(e.text)
    const spec = m && WINDOWS[m[2]]
    if (m && spec) {
      const r: Role = { project: m[1], window: m[2], card: `${CARDS}${spec.card}.md`, expect: spec.expect }
      await update($, role, () => r)
      const model = await $.session.model()
      $.ui.status(statusOf(r, model))
      if (!model.toLowerCase().includes(spec.expect)) $.ui.toast(`⚠ ${r.window}窗照角色表用 ${spec.expect}，目前是 ${model}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // 認窗出錯不得吞掉 Ryan 的訊息

  on('agent.spawn', async ($, e, next) => {
    if (!e.prompt.includes(OVERRIDE)) {
      if (e.parentAgentId) {
        return { deny: `dev-roles（G16）：背景窗不得再派子代理。需要平行處理就回報派工方，由主窗派。確有必要在 prompt 寫 ${OVERRIDE}。` }
      }
      if (INHERITS.has(e.subagentType) && !e.model) {
        return { deny: `dev-roles（G16）：派 ${e.subagentType} 必須明示 model；不寫＝繼承主模型 ${e.parentModel}。確有必要在 prompt 寫 ${OVERRIDE}。` }
      }
    }
    const r = await next(e)
    try { // 記錄失敗不能讓 .catch 再派一次
      if (r.agentId) {
        const now = Date.now()
        live.set(r.agentId, { id: r.agentId, desc: e.description || e.subagentType, model: r.model, start: now, last: now, tools: 0, status: 'running' })
      }
    } catch { /* 監控記錄失敗不影響派工 */ }
    return r
  }).catch(($, e, next) => next(e)) // 守門自己壞掉時放行，不擋工作

  on('tool.call', async ($, e, next) => {
    const a = e.agentId ? live.get(e.agentId) : undefined
    if (a) { a.tools++; a.last = Date.now() }
    return next(e)
  }).catch(($, e, next) => next(e)) // 監控出錯不得擋工具

  on('turn.complete', async ($, e, next) => {
    const a = e.agentId ? live.get(e.agentId) : undefined
    if (a) {
      const u = e.usage
      a.tokens = u ? u.input_tokens + u.output_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : undefined
      a.end = Date.now()
      a.status = e.isAborted ? 'stopped' : 'done'
      await update($, bg, snap)
    }
    return next(e)
  })

  on('command.run', { command: '背景窗' }, async $ => {
    await update($, bg, snap)
    void $.ui.open({ id: PANE, title: '背景窗' })
    const now = Date.now()
    const list = [...live.values()]
    return { text: list.length ? list.map(a => lineOf(a, now)).join('\n') : '這個 session 還沒有派背景窗。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, bg)
    const now = Date.now()
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>還沒有派背景窗。</Text>}
        {list.map(a => (
          <Text dimColor={a.status !== 'running'}>{lineOf(a, now)}</Text>
        ))}
        <Text dimColor>閒置 ≥ {IDLE_MIN} 分鐘會跳提醒；每 30 秒更新。</Text>
      </Box>
    )
  })
}
