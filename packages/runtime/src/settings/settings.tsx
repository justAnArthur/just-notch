import type { HostInfo, InstalledPlugin, Methods } from '@just-notch/bridge-schema'
import {
  Badge,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  Sidebar,
  Switch,
  SwitchGroup,
} from '@justanarthur/modo-ui'
import { Info, Puzzle, ShieldCheck } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { on } from '../host/bus'
import { call } from '../host/client'
import { syncPlugins, usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'

type SystemPermission = Methods['permissions.status']['params']['permission']
const PERMISSIONS: { id: SystemPermission; label: string; description: string }[] = [
  { id: 'accessibility', label: 'Accessibility', description: 'Replaces the volume and brightness HUD with the island.' },
  { id: 'calendar', label: 'Calendar', description: 'Shows upcoming events.' },
  { id: 'bluetooth', label: 'Bluetooth', description: 'Announces connected devices and their battery.' },
  { id: 'automation', label: 'Automation', description: 'Controls the apps that play media.' },
]

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title weight-semibold text-foreground">{title}</h1>
        {lead && <p className="text-body text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

function Plugins({ plugins }: { plugins: InstalledPlugin[] }) {
  if (plugins.length === 0) return <p className="text-body text-muted-foreground">No plugins installed.</p>
  return (
    <SwitchGroup>
      {plugins.map(({ manifest, enabled }) => (
        <Switch
          key={manifest.id}
          label={manifest.name}
          description={manifest.description ?? `${manifest.id} ${manifest.version}`}
          checked={enabled}
          onCheckedChange={(next) => void call('runtime', 'plugins.setEnabled', { id: manifest.id, enabled: next })}
        />
      ))}
    </SwitchGroup>
  )
}

function Permissions() {
  const [granted, setGranted] = useState<Partial<Record<SystemPermission, boolean>>>({})
  useEffect(() => {
    for (const { id } of PERMISSIONS)
      call('runtime', 'permissions.status', { permission: id }).then(({ granted }) => setGranted((g) => ({ ...g, [id]: granted })))
  }, [])
  return (
    <div className="flex flex-col">
      {PERMISSIONS.map(({ id, label, description }) => (
        <div key={id} className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
          <div className="flex min-w-0 flex-col">
            <span className="text-body text-foreground">{label}</span>
            <span className="text-caption text-muted-foreground">{description}</span>
          </div>
          {id in granted && (
            <Badge color={granted[id] ? 'green' : 'amber'}>{granted[id] ? 'Granted' : 'Not granted'}</Badge>
          )}
        </div>
      ))}
    </div>
  )
}

function About({ info }: { info: HostInfo }) {
  const rows = [
    ['Version', info.version],
    ['Mode', info.devMode ? `Development${info.devServerUrl ? ` · ${info.devServerUrl}` : ''}` : 'Release'],
    ['Screen', `${info.geometry.panel.w} × ${info.geometry.panel.h} panel, ${info.geometry.hasNotch ? 'hardware notch' : 'virtual notch'}`],
  ]
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-body text-muted-foreground">{label}</dt>
          <dd className="text-body text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The settings window: plugins with their switches and settings views, permissions, about. */
export default function Settings({ info }: { info: HostInfo }) {
  const [installed, setInstalled] = useState(info.plugins)
  const [section, setSection] = useState('plugins')
  const loaded = usePlugins()

  useEffect(() => {
    void syncPlugins(installed, false)
  }, [installed])
  useEffect(() => on('plugins.changed', ({ plugins }) => setInstalled(plugins)), [])

  const withSettings = loaded.filter((p) => p.definition.settings)
  const current = withSettings.find((p) => `plugin:${p.installed.manifest.id}` === section)

  return (
    <SidebarProvider className="h-screen min-h-0" persist={false} mobileBreakpoint={0}>
      <Sidebar className="h-full" value={section} onValueChange={setSection}>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Just Notch</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton icon={Puzzle} value="plugins">Plugins</SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton icon={ShieldCheck} value="permissions">Permissions</SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton icon={Info} value="about">About</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {withSettings.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel>Plugin settings</SidebarGroupLabel>
              <SidebarMenu>
                {withSettings.map(({ installed }) => (
                  <SidebarMenuItem key={installed.manifest.id}>
                    <SidebarMenuButton value={`plugin:${installed.manifest.id}`}>{installed.manifest.name}</SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-160 flex-col gap-8 px-8 py-10">
          {section === 'plugins' && (
            <Section title="Plugins" lead="Each plugin adds activities and widgets to the island.">
              <Plugins plugins={installed} />
            </Section>
          )}
          {section === 'permissions' && (
            <Section title="Permissions" lead="What macOS lets Just Notch read and control.">
              <Permissions />
            </Section>
          )}
          {section === 'about' && (
            <Section title="About">
              <About info={info} />
            </Section>
          )}
          {current && (
            <Section title={current.installed.manifest.name} lead={current.installed.manifest.description}>
              <PluginView plugin={current.installed.manifest.id} view={current.definition.settings} />
            </Section>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
