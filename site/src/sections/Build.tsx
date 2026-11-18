import Copy from '@justanarthur/modo-ui/components/actions/copy'
import Tabs from '@justanarthur/modo-ui/components/navigation/tabs'
import Code from '@justanarthur/modo-ui/primitives/content/code'
import { CREATE_COMMAND, REPO_URL } from '../data'

// What `notch create my-plugin` writes (packages/cli/src/create.ts), trimmed to the parts that matter.
const TERMINAL = `${CREATE_COMMAND}
bun install
cd plugins/my-plugin && bun run dev`

const MANIFEST = `{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "style": "dist/index.css",
  "permissions": [],
  "engines": { "notch": "^0.1.0" }
}`

const SOURCE = `import { Button } from '@justanarthur/modo-ui'
import { definePlugin, usePlugin } from '@just-notch/sdk'

function Hello() {
  return <p className="text-subtitle px-4 py-2">Hello from My Plugin</p>
}

function Widget() {
  const { activity } = usePlugin()
  return (
    <Button
      variant="secondary"
      size="compact"
      onClick={() => activity.flash({ priority: 'alert', view: Hello })}
    >
      Say hello
    </Button>
  )
}

export default definePlugin({
  widget: { title: 'My Plugin', view: Widget },
})`

export function Build() {
  return (
    <section className="build field-ink" id="build" aria-labelledby="build-title">
      <div className="build-copy">
        <h2 className="headline" id="build-title" data-rv>
          Write a plugin<br /> of your own.
        </h2>
        <p className="body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          A plugin is a React component, a manifest and the permissions it asks for. It draws with modo-ui, the
          island's own components, so it looks native from the first line. The CLI scaffolds, builds and packs
          it into a .notchplugin; while you work, the runtime's dev server reloads the island on every save.
        </p>
        <div className="build-command" data-rv style={{ '--i': 2 } as React.CSSProperties}>
          <Copy value={CREATE_COMMAND} label="Start here" />
        </div>
        <a className="text-link" href={REPO_URL} data-rv style={{ '--i': 3 } as React.CSSProperties}>
          The SDK and the CLI on GitHub
        </a>
      </div>
      <div className="build-code" data-rv style={{ '--i': 2 } as React.CSSProperties}>
        <Tabs defaultValue="source" size="compact">
          <Tabs.List aria-label="Files of a new plugin">
            <Tabs.Item value="terminal" label="Terminal" />
            <Tabs.Item value="manifest" label="manifest.json" />
            <Tabs.Item value="source" label="src/index.tsx" />
          </Tabs.List>
          <Tabs.Panel value="terminal">
            <Code language="sh" className="code">{TERMINAL}</Code>
          </Tabs.Panel>
          <Tabs.Panel value="manifest">
            <Code language="json" className="code">{MANIFEST}</Code>
          </Tabs.Panel>
          <Tabs.Panel value="source">
            <Code language="tsx" className="code">{SOURCE}</Code>
          </Tabs.Panel>
        </Tabs>
      </div>
    </section>
  )
}
