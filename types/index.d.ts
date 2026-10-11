export type Role = { project: string; window: string; card: string; expect: string }

export type BgAgent = {
  id: string
  desc: string
  model: string
  start: number
  last: number
  end?: number
  tools: number
  tokens?: number
  status: 'running' | 'done' | 'stopped'
}

declare module 'claude-code' {
  interface PluginState {
    'dev-roles': { role: Role | null; bg: BgAgent[] }
  }
}
