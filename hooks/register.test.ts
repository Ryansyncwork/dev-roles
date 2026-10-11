import { expect, test } from 'claude-code/testing'

const started = { model: 'claude-haiku-5-5', agentId: 'a-test' }

test('G16：主窗派 general-purpose 沒寫 model → 擋下', async ($, on) => {
  on('agent.spawn', () => started)
  const r = await $.agent.spawn({ prompt: '查東西', subagentType: 'general-purpose' })
  expect(r.deny).toContain('必須明示 model')
})

test('G16：寫了 model → 放行', async ($, on) => {
  on('agent.spawn', () => started)
  const r = await $.agent.spawn({ prompt: '查東西', subagentType: 'general-purpose', model: 'haiku' })
  expect(r.deny).toBeUndefined()
  expect(r.agentId).toBe('a-test')
})

test('G16：自訂型別（定義自帶 model）沒寫 model → 放行', async ($, on) => {
  on('agent.spawn', () => started)
  const r = await $.agent.spawn({ prompt: '施工', subagentType: 'opus-xhigh' })
  expect(r.deny).toBeUndefined()
})

test('G16：prompt 帶 [G16-OK] → 放行', async ($, on) => {
  on('agent.spawn', () => started)
  const r = await $.agent.spawn({ prompt: '[G16-OK] 例外', subagentType: 'Explore' })
  expect(r.deny).toBeUndefined()
})

for (const [said, project, window, want] of [
  ['你是 hub PM', 'hub', 'PM', 'opus'],
  ['你是 工地管理 設計窗', '工地管理', '設計', 'opus'],
  ['你是 思考-待題 思考窗。', '思考-待題', '思考', 'fable'],
  ['你是 工作區 AI調整窗', '工作區', 'AI調整', 'opus'],
] as const) {
  test(`認窗：「${said}」→ 記下角色（${want}）`, async ($, on) => {
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    const status: string[] = []
    const toast: string[] = []
    on('ui.status', ($, e) => { status.push(JSON.stringify(e)); return { value: undefined } as never })
    on('ui.toast', ($, e) => { toast.push(JSON.stringify(e)); return { value: undefined } as never })
    await $.prompt.submit({ text: said })
    expect(status.join()).toContain(`${project}-${window} · claude-opus-5-5`)
    expect(toast.length).toBe(want === 'opus' ? 0 : 1)  // fable 窗開在 opus 上要提醒
  })
}

test('認窗：一般句子不動角色', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const status: string[] = []
  on('ui.status', ($, e) => { status.push(JSON.stringify(e)); return { value: undefined } as never })
  await $.prompt.submit({ text: '你是說這個按鈕要改顏色嗎' })
  expect(status.length).toBe(0)
})

test('背景窗：派出去的會列在 /背景窗', async ($, on) => {
  on('agent.spawn', () => started)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await $.agent.spawn({ prompt: '跑驗收', description: 'hub-143H-功能驗收', subagentType: 'general-purpose', model: 'haiku' })
  const r = await $.command.run({ command: '背景窗' })
  expect(r.text).toContain('hub-143H-功能驗收')
  expect(r.text).toContain('工具 0')
})

test('背景窗：被守門擋下的不列', async ($, on) => {
  on('agent.spawn', () => started)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await $.agent.spawn({ prompt: '查', description: '沒寫model', subagentType: 'general-purpose' })
  const r = await $.command.run({ command: '背景窗' })
  expect(r.text).not.toContain('沒寫model')
})
