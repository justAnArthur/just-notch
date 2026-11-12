import { PluginContextProvider } from '@just-notch/sdk'
import { Component, type ComponentType, type ReactNode } from 'react'
import { log } from '../host/client'
import { getPlugin } from './loader'

interface BoundaryProps {
  plugin: string
  children: ReactNode
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    log('error', `plugin ${this.props.plugin} view crashed: ${error instanceof Error ? error.stack ?? error.message : error}`)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

interface PluginViewProps {
  plugin: string
  view?: ComponentType
}

/** A plugin's view, scoped to its context; a crash shows nothing and is logged, never breaking the island. */
export default function PluginView({ plugin, view: View }: PluginViewProps) {
  const ctx = getPlugin(plugin)?.ctx
  if (!ctx || !View) return null
  return (
    <PluginContextProvider value={ctx}>
      <Boundary key={plugin} plugin={plugin}>
        <View />
      </Boundary>
    </PluginContextProvider>
  )
}
