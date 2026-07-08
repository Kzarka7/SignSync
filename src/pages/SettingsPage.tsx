import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../services/api/settingsService'
import { AppSettings } from '../types/settings'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/shared/Card'
import SettingsNav from '../components/settings/SettingsNav'
import SettingRow from '../components/settings/SettingRow'
import Toggle from '../components/settings/Toggle'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  function patch(partial: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...partial }
    setSettings(next) // optimistic update
    updateSettings(partial)
  }

  if (!settings) return null

  return (
    <div>
      <PageHeader title="Settings" description="Tune how Daloy looks, sounds, and responds to you." />
      <div className="grid grid-cols-[220px_1fr] gap-6">
        <SettingsNav onSelect={() => {}} />
        <Card>
          <SettingRow
            label="Theme"
            description="Light, dark, or match your device."
            control={
              <select
                className="text-sm border border-border rounded-lg px-2.5 py-2 bg-white"
                value={settings.theme}
                onChange={(e) => patch({ theme: e.target.value as AppSettings['theme'] })}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            }
          />
          <SettingRow
            label="Interface language"
            description="Applies to menus and captions."
            control={
              <select
                className="text-sm border border-border rounded-lg px-2.5 py-2 bg-white"
                value={settings.interfaceLanguage}
                onChange={(e) => patch({ interfaceLanguage: e.target.value as AppSettings['interfaceLanguage'] })}
              >
                <option value="en">English</option>
                <option value="fil">Filipino</option>
              </select>
            }
          />
          <SettingRow
            label="High contrast mode"
            description="Increases contrast across the interface."
            control={<Toggle checked={settings.highContrast} onChange={(v) => patch({ highContrast: v })} />}
          />
          <SettingRow
            label="Large text"
            description="Increases font size in the conversation timeline."
            control={<Toggle checked={settings.largeText} onChange={(v) => patch({ largeText: v })} />}
          />
          <SettingRow
            label="Avatar signing speed"
            description="How quickly the FSL avatar signs translated speech."
            control={
              <select
                className="text-sm border border-border rounded-lg px-2.5 py-2 bg-white"
                value={settings.avatarSpeed}
                onChange={(e) => patch({ avatarSpeed: Number(e.target.value) as AppSettings['avatarSpeed'] })}
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1x</option>
                <option value={1.25}>1.25x</option>
              </select>
            }
          />
          <SettingRow
            label="Save conversations automatically"
            description="Sessions are saved to History unless you turn this off."
            control={<Toggle checked={settings.autoSaveConversations} onChange={(v) => patch({ autoSaveConversations: v })} />}
          />
        </Card>
      </div>
    </div>
  )
}
