import { useState } from 'react'
import { toast } from 'sonner'
import { useTalkyConsole } from '@/context/TalkyConsoleContext'
import { readBoolean } from '@/types/api'

/** Live "Pause replies" kill switch state (`repliesPaused` in config.yaml). */
export function useRepliesPause() {
  const { config, updateConfig } = useTalkyConsole()
  const [busy, setBusy] = useState(false)
  const paused = config ? readBoolean(config, 'repliesPaused') : false
  const setPaused = async (next: boolean) => {
    if (busy) return
    setBusy(true)
    const ok = await updateConfig({ repliesPaused: next })
    setBusy(false)
    if (!ok) return
    if (next) toast.warning('Replies paused. Talky keeps recording messages but will not answer.')
    else toast.success('Replies resumed. Talky is answering again.')
  }
  return { paused, busy, ready: config !== null, setPaused }
}
