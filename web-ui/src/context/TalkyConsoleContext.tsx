import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import {
  applyPermissionsSliceToConfig,
  readPermissionsSlice,
  type ChatEntry,
  type ClaudeEvent,
  type ClaudeStatus,
  type DebugLogEvent,
  type OverviewStats,
  type GroupRow,
  type PersonaPayload,
  type StatusPayload,
  type TalkyConfig,
  type UnauthorizedCandidate,
} from '@/types/api'

type TalkyConsoleState = {
  status: StatusPayload | null
  config: TalkyConfig | null
  /** Working copy for Allowlists / permissions; synced from server when not dirty. */
  configDraft: TalkyConfig | null
  configDirty: boolean
  unauthorized: UnauthorizedCandidate[]
  groups: GroupRow[]
  chats: Record<string, ChatEntry[]>
  editingPersona: PersonaPayload
  personaDirty: boolean
  debugEvents: DebugLogEvent[]
  claudeStatus: ClaudeStatus | null
  claudePending: ClaudeEvent[]
  stats: OverviewStats | null
  /** True when the last status poll failed (bot not running / proxy mismatch). */
  offline: boolean
  refresh: () => Promise<void>
  refreshStats: () => Promise<void>
  /** Update one or more config keys server-side (validated; locked keys are refused). */
  updateConfig: (patch: Partial<TalkyConfig>) => Promise<boolean>
  setEditingPersona: (next: PersonaPayload) => void
  savePersona: () => Promise<void>
  patchConfigDraft: (
    patch: Partial<TalkyConfig> | ((prev: TalkyConfig) => TalkyConfig),
  ) => void
  saveConfigDraft: () => Promise<void>
  resetConfigDraft: () => void
  resolveUnauthorized: (
    jid: string,
    action: 'allow' | 'discard',
    listType: 'direct' | 'group',
  ) => Promise<void>
  sessionAction: (action: 'relink' | 'repair' | 'full-relink') => Promise<void>
  deleteChat: (jid: string) => Promise<boolean>
}

const TalkyConsoleContext = createContext<TalkyConsoleState | null>(null)

const POLL_MS = 3000
const STATS_POLL_MS = 15_000
/** After relink, poll status faster while Baileys emits a new QR. */
const RELINK_FAST_POLL_MS = 1000
const RELINK_FAST_POLL_DURATION_MS = 60_000

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
  }
  return res.json() as Promise<T>
}

/** GET JSON without throwing — avoids one failing `/api/*` breaking the whole console. */
async function fetchJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path)
    if (!res.ok) {
      console.warn(`[Talky UI] ${path} → ${res.status}`)
      return null
    }
    // Awaited so a non-JSON 200 (e.g. a dev-server fallback page) is caught here instead of
    // rejecting the whole poll's Promise.all.
    return (await res.json()) as T
  } catch (e) {
    console.warn(`[Talky UI] ${path}`, e)
    return null
  }
}

export function TalkyConsoleProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [config, setConfig] = useState<TalkyConfig | null>(null)
  const [unauthorized, setUnauthorized] = useState<UnauthorizedCandidate[]>([])
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [chats, setChats] = useState<Record<string, ChatEntry[]>>({})
  const [editingPersona, setEditingPersonaState] = useState<PersonaPayload>({
    soul: '',
    communicationRules: '',
    recentMemory: '',
  })
  const [personaDirty, setPersonaDirty] = useState(false)
  const [debugEvents, setDebugEvents] = useState<DebugLogEvent[]>([])
  const personaInitialized = useRef(false)
  /** Read when a poll RESOLVES: a poll started before the first keystroke must not overwrite it. */
  const personaDirtyRef = useRef(false)
  const configDirtyRef = useRef(false)
  /** Server config the current draft was cloned from — Save sends only keys edited since. */
  const configBaseRef = useRef<TalkyConfig | null>(null)
  const [configDraft, setConfigDraft] = useState<TalkyConfig | null>(null)
  const [configDirty, setConfigDirty] = useState(false)
  const fetchOkRef = useRef(true)
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null)
  const [claudePending, setClaudePending] = useState<ClaudeEvent[]>([])
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [offline, setOffline] = useState(false)

  const fetchData = useCallback(async () => {
    const st = await fetchJsonSafe<StatusPayload>('/api/status')
    if (st) setStatus(st)

    /** Avoid hammering `/api/groups` while WhatsApp is down/relinking — cuts Vite proxy "socket hang up" spam. */
    const fetchGroups =
      st?.whatsappConnected === true ? fetchJsonSafe<GroupRow[]>('/api/groups') : Promise.resolve(null)

    const [cfg, unauth, grp, per, ch, dbg, cst, cpend] = await Promise.all([
      fetchJsonSafe<TalkyConfig>('/api/config'),
      fetchJsonSafe<UnauthorizedCandidate[]>('/api/unauthorized'),
      fetchGroups,
      fetchJsonSafe<PersonaPayload>('/api/persona'),
      fetchJsonSafe<Record<string, ChatEntry[]>>('/api/chats'),
      fetchJsonSafe<DebugLogEvent[]>('/api/logs/events?limit=300'),
      fetchJsonSafe<ClaudeStatus>('/api/claude/status'),
      fetchJsonSafe<ClaudeEvent[]>('/api/claude/pending'),
    ])
    if (cst) setClaudeStatus(cst)
    if (cpend && Array.isArray(cpend)) setClaudePending(cpend)

    const heartbeatOk = st !== null
    setOffline(!heartbeatOk)

    if (cfg) {
      setConfig(cfg)
      setConfigDraft((prev) => {
        if (configDirtyRef.current && prev) return prev
        configBaseRef.current = structuredClone(cfg)
        return structuredClone(cfg)
      })
    }
    if (unauth) setUnauthorized(unauth)
    if (grp && Array.isArray(grp)) setGroups(grp)
    if (ch) setChats(ch)
    if (dbg && Array.isArray(dbg)) setDebugEvents(dbg)

    if (per) {
      if (!personaInitialized.current) {
        setEditingPersonaState(per)
        personaInitialized.current = true
      } else if (!personaDirtyRef.current) {
        setEditingPersonaState(per)
      }
    }

    if (heartbeatOk && !fetchOkRef.current) {
      fetchOkRef.current = true
      toast.success('Talky API reachable again')
    }
    if (!heartbeatOk && fetchOkRef.current) {
      fetchOkRef.current = false
      toast.error(
        'Cannot reach Talky API (check the bot is running and Vite proxy matches WEB_UI_PORT).',
        { duration: 8000 },
      )
    }
  }, [])

  useEffect(() => {
    let alive = true
    const boot = window.setTimeout(() => {
      if (alive) void fetchData()
    }, 0)
    const id = window.setInterval(() => {
      if (alive) void fetchData()
    }, POLL_MS)
    return () => {
      alive = false
      window.clearTimeout(boot)
      window.clearInterval(id)
    }
  }, [fetchData])

  const refreshStats = useCallback(async () => {
    const next = await fetchJsonSafe<OverviewStats>('/api/stats/overview')
    if (next) setStats(next)
  }, [])

  useEffect(() => {
    const boot = window.setTimeout(() => void refreshStats(), 0)
    const id = window.setInterval(() => void refreshStats(), STATS_POLL_MS)
    return () => {
      window.clearTimeout(boot)
      window.clearInterval(id)
    }
  }, [refreshStats])

  const updateConfig = useCallback(
    async (patch: Partial<TalkyConfig>): Promise<boolean> => {
      try {
        const res = await fetchJson<{ success: boolean; rejectedKeys?: string[] }>('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (res.rejectedKeys && res.rejectedKeys.length > 0) {
          toast.warning(`Not applied (locked or invalid): ${res.rejectedKeys.join(', ')}`)
        }
        void fetchData()
        return true
      } catch (e) {
        console.error('[Talky UI] update config', e)
        toast.error('Failed to update configuration')
        return false
      }
    },
    [fetchData],
  )

  const setEditingPersona = useCallback((next: PersonaPayload) => {
    personaDirtyRef.current = true
    setEditingPersonaState(next)
    setPersonaDirty(true)
  }, [])

  const savePersona = useCallback(async () => {
    try {
      await fetchJson('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingPersona),
      })
    } catch (e) {
      // Callers fire-and-forget; report here instead of leaking an unhandled rejection.
      console.error('[Talky UI] save persona', e)
      toast.error('Could not save persona — your edits are kept. Is Talky running?')
      return
    }
    toast.success('Persona saved')
    personaDirtyRef.current = false
    setPersonaDirty(false)
    void fetchData()
  }, [editingPersona, fetchData])

  const resolveUnauthorized = useCallback(
    async (
      jid: string,
      action: 'allow' | 'discard',
      listType: 'direct' | 'group',
    ) => {
      try {
        await fetchJson('/api/unauthorized/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jid, action, listType }),
        })
      } catch (e) {
        console.error('[Talky UI] resolve unknown sender', e)
        toast.error(`Could not ${action === 'allow' ? 'allow' : 'dismiss'} ${jid} — is Talky running?`)
        return
      }
      toast.success(action === 'allow' ? 'Allowed' : 'Dismissed')
      void fetchData()
    },
    [fetchData],
  )

  const deleteChat = useCallback(async (jid: string): Promise<boolean> => {
    const unreachable =
      'Cannot reach Talky. Run `bun run start` (or `bun run dev`) from the repository root while using `ui:dev`, ' +
      'or set web-ui `VITE_API_PROXY_TARGET` / `WEB_UI_PORT` so the proxy points at the listening control server.'
    try {
      const res = await fetch(`/api/chats?jid=${encodeURIComponent(jid)}`, {
        method: 'DELETE',
      })
      let payload: { success?: boolean; removed?: boolean; error?: string } = {}
      try {
        payload = (await res.json()) as typeof payload
      } catch {
        /* non-JSON body (e.g. Vite proxy error page HTML) */
      }
      if (!res.ok) {
        if (payload.error) {
          toast.error(`Failed to delete chat history: ${payload.error}`)
          return false
        }
        if ([502, 503, 504].includes(res.status)) {
          toast.error(`Failed to delete chat history: ${unreachable}`)
          return false
        }
        if (res.status === 500) {
          toast.error(`Failed to delete chat history: ${unreachable}`)
          return false
        }
        if (res.status === 404) {
          toast.error(
            'Failed to delete chat history: No handler for this route (404). Restart Talky from the repo root with the latest code so `DELETE /api/chats` is available.',
          )
          return false
        }
        toast.error(`Failed to delete chat history: HTTP ${res.status}`)
        return false
      }
      if (!payload.success) {
        toast.error(`Failed to delete chat history: ${payload.error ?? 'Unknown error'}`)
        return false
      }
      toast.success(
        payload.removed === false ? 'No local chat file (already absent).' : 'Chat history deleted',
      )
      void fetchData()
      return true
    } catch (e) {
      console.error('[Talky UI] delete chat', e)
      const msg = e instanceof Error ? e.message : String(e)
      const looksNetwork =
        msg.includes('Failed to fetch') ||
        msg.includes('Load failed') ||
        msg.includes('NetworkError') ||
        msg.includes('ECONNREFUSED')
      toast.error(
        looksNetwork
          ? `Failed to delete chat history: ${unreachable}`
          : `Failed to delete chat history: ${msg}`,
      )
      return false
    }
  }, [fetchData])

  const sessionAction = useCallback(
    async (action: 'relink' | 'repair' | 'full-relink') => {
      const unreachable =
        'Talky bot not reachable — run `bun run start` (or dev) from the repo root, ' +
        'and ensure Vite proxy `VITE_API_PROXY_TARGET` / `WEB_UI_PORT` matches the control server.'
      const label =
        action === 'repair' ? 'Repair' : action === 'full-relink' ? 'Full reset' : 'Relink'
      try {
        if (action === 'full-relink') {
          // Clear stale UI state immediately while backend restarts from a clean slate.
          setChats({})
          setUnauthorized([])
          setDebugEvents([])
          setGroups([])
          setConfig(null)
          setConfigDraft(null)
          configDirtyRef.current = false
          setConfigDirty(false)
          setEditingPersonaState({
            soul: '',
            communicationRules: '',
            recentMemory: '',
          })
          personaDirtyRef.current = false
          setPersonaDirty(false)
        }
        const path =
          action === 'repair'
            ? '/api/session/repair'
            : action === 'full-relink'
              ? '/api/session/full-reset'
              : '/api/session/relink'
        const bodyJson =
          action === 'full-relink'
            ? JSON.stringify({ fullReset: true })
            : '{}'
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyJson,
        })
        let payload: { success?: boolean; error?: string } = {}
        try {
          payload = (await res.json()) as typeof payload
        } catch {
          /* non-JSON response */
        }
        if (!res.ok) {
          if (payload.error) {
            toast.error(`${label} failed: ${payload.error}`)
          } else if ([502, 503, 504].includes(res.status)) {
            toast.error(unreachable)
          } else if (res.status === 404) {
            toast.error(
              `${label} route not found (404). Restart Talky with the latest code.`,
            )
          } else {
            toast.error(`${label} failed: HTTP ${res.status}`)
          }
          return
        }
        toast.message(
          action === 'full-relink'
            ? 'Factory reset complete — local data wiped. Scan the new QR in Actions or terminal.'
            : `Session ${action} initiated`,
        )
        void fetchData()
        if (action === 'relink' || action === 'full-relink') {
          const started = Date.now()
          const fast = window.setInterval(() => {
            void fetchData()
            if (Date.now() - started >= RELINK_FAST_POLL_DURATION_MS) {
              window.clearInterval(fast)
            }
          }, RELINK_FAST_POLL_MS)
        }
      } catch (e) {
        console.error('[Talky UI] session action', e)
        const msg = e instanceof Error ? e.message : String(e)
        const looksNetwork =
          msg.includes('Failed to fetch') ||
          msg.includes('Load failed') ||
          msg.includes('NetworkError') ||
          msg.includes('ECONNREFUSED')
        toast.error(looksNetwork ? unreachable : msg)
      }
    },
    [fetchData],
  )

  const patchConfigDraft = useCallback(
    (patch: Partial<TalkyConfig> | ((prev: TalkyConfig) => TalkyConfig)) => {
      setConfigDraft((d) => {
        const base =
          d ?? (config ? structuredClone(config) : ({} as TalkyConfig))
        const next =
          typeof patch === 'function' ? patch(base) : { ...base, ...patch }
        return next
      })
      configDirtyRef.current = true
      setConfigDirty(true)
    },
    [config],
  )

  const resetConfigDraft = useCallback(() => {
    if (!config) return
    configBaseRef.current = structuredClone(config)
    setConfigDraft(structuredClone(config))
    configDirtyRef.current = false
    setConfigDirty(false)
  }, [config])

  const saveConfigDraft = useCallback(async () => {
    if (!configDraft) {
      toast.error('Configuration not loaded')
      return
    }
    try {
      const full = applyPermissionsSliceToConfig(
        configDraft,
        readPermissionsSlice(configDraft),
      )
      // Send only what was edited on this page. Posting the whole draft would revert anything
      // changed elsewhere since it was cloned (engine switch, allowed senders, model, pause).
      const base = configBaseRef.current ?? {}
      const body: Partial<TalkyConfig> = {}
      for (const [key, value] of Object.entries(full)) {
        if (JSON.stringify(value) !== JSON.stringify((base as Record<string, unknown>)[key])) {
          ;(body as Record<string, unknown>)[key] = value
        }
      }
      // The pause switch has its own button; a draft must never change it.
      delete body.repliesPaused
      await fetchJson<{ success: boolean }>('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      toast.success('Configuration saved')
      configDirtyRef.current = false
      setConfigDirty(false)
      void fetchData()
    } catch (e) {
      console.error('[Talky UI] save config', e)
      toast.error('Failed to save configuration')
    }
  }, [configDraft, fetchData])

  const value = useMemo(
    (): TalkyConsoleState => ({
      status,
      config,
      configDraft,
      configDirty,
      unauthorized,
      groups,
      chats,
      editingPersona,
      personaDirty,
      debugEvents,
      claudeStatus,
      claudePending,
      stats,
      offline,
      refresh: fetchData,
      refreshStats,
      updateConfig,
      setEditingPersona,
      savePersona,
      patchConfigDraft,
      saveConfigDraft,
      resetConfigDraft,
      resolveUnauthorized,
      sessionAction,
      deleteChat,
    }),
    [
      status,
      config,
      configDraft,
      configDirty,
      unauthorized,
      groups,
      chats,
      editingPersona,
      personaDirty,
      debugEvents,
      claudeStatus,
      claudePending,
      stats,
      offline,
      fetchData,
      refreshStats,
      updateConfig,
      setEditingPersona,
      savePersona,
      patchConfigDraft,
      saveConfigDraft,
      resetConfigDraft,
      resolveUnauthorized,
      sessionAction,
      deleteChat,
    ],
  )

  return (
    <TalkyConsoleContext.Provider value={value}>
      {children}
    </TalkyConsoleContext.Provider>
  )
}

export function useTalkyConsole(): TalkyConsoleState {
  const ctx = useContext(TalkyConsoleContext)
  if (!ctx) {
    throw new Error('useTalkyConsole must be used within TalkyConsoleProvider')
  }
  return ctx
}
