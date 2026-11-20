import { useStored } from './apps'
import { type Frecency, type Knowledge, learn, record } from './frecency'
import { forget, type ItemSnapshot, type LauncherPrefs, snapshotOf, withDefaults } from './prefs'
import type { Row } from './rows'

const FRECENCY_KEY = 'launcher.frecency'
const KNOWLEDGE_KEY = 'launcher.knowledge'
export const PREFS_KEY = 'launcher.prefs'
const SNAPSHOTS_KEY = 'launcher.items'

/** Everything the launcher remembers, in the runtime's storage and shared by every screen's panel and Settings. */
export interface LauncherStore {
  frecency: Frecency
  knowledge: Knowledge
  prefs: LauncherPrefs
  /** What it keeps of each result it may show again (Recent, Favourites, aliases, hotkeys). */
  snapshots: Record<string, ItemSnapshot>
  /** A result was picked for `query`: counts it, learns it, keeps what it needs to show it again. */
  launched(row: Row, query: string): void
  /** Changes the preferences; `rows` are kept so they can be shown again (a new favourite, an alias). */
  update(change: (prefs: LauncherPrefs) => LauncherPrefs, rows?: Row[]): void
  /** Forgets how often and for what a result was picked. */
  resetRanking(id: string): void
  /** Forgets every result's ranking. */
  resetAll(): void
}

export function useLauncherStore(): LauncherStore {
  const [frecency, setFrecency] = useStored<Frecency>(FRECENCY_KEY)
  const [knowledge, setKnowledge] = useStored<Knowledge>(KNOWLEDGE_KEY)
  const [stored, setStored] = useStored<Partial<LauncherPrefs>>(PREFS_KEY)
  const [snapshots, setSnapshots] = useStored<Record<string, ItemSnapshot>>(SNAPSHOTS_KEY)
  const prefs = withDefaults(stored)

  /** Keeps the rows' snapshots, and drops those nothing refers to any more. */
  const keep = (rows: Row[], nextFrecency = frecency, nextPrefs = prefs) => {
    const wanted = new Set([...Object.keys(nextFrecency), ...nextPrefs.favourites, ...Object.keys(nextPrefs.items)])
    const next: Record<string, ItemSnapshot> = {}
    for (const [id, snap] of Object.entries(snapshots)) if (wanted.has(id)) next[id] = snap
    for (const row of rows) {
      const snap = snapshotOf(row)
      if (snap && wanted.has(snap.id)) next[snap.id] = snap
    }
    setSnapshots(next)
  }

  return {
    frecency,
    knowledge,
    prefs,
    snapshots,
    launched(row, query) {
      const nextFrecency = record(frecency, row.id)
      setFrecency(nextFrecency)
      if (query) setKnowledge(learn(knowledge, query, row.id))
      keep([row], nextFrecency)
    },
    update(change, rows = []) {
      const next = change(prefs)
      setStored(next)
      keep(rows, frecency, next)
    },
    resetAll() {
      setFrecency({})
      setKnowledge({})
    },
    resetRanking(id) {
      const next = forget(frecency, knowledge, id)
      setFrecency(next.frecency)
      setKnowledge(next.knowledge)
    },
  }
}
