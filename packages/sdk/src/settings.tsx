import { List, LIST_SWITCH, Select, Switch } from '@justanarthur/modo-ui'
import type { ReactNode } from 'react'

export interface SwitchRowProps {
  label: string
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A settings row: label, what it does, a switch at the end. */
export function SwitchRow({ label, description, checked, onCheckedChange }: SwitchRowProps) {
  return (
    <List.Row label={label} description={description}>
      <Switch aria-label={label} className={LIST_SWITCH} checked={checked} onCheckedChange={onCheckedChange} />
    </List.Row>
  )
}

export interface SelectRowProps<T extends string> {
  label: string
  description?: ReactNode
  options: { value: T; label: string }[]
  value: T
  onValueChange: (value: T) => void
}

/** A settings row: label, what it does, a borderless select at the end. */
export function SelectRow<T extends string>({ label, description, options, value, onValueChange }: SelectRowProps<T>) {
  return (
    <List.Row label={label} description={description}>
      <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
        <Select.Trigger variant="borderless" className="min-w-0" aria-label={label} />
        <Select.Content>
          {options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </List.Row>
  )
}
