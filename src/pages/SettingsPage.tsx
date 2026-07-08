import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../services/api/settingsService'
import { AppSettings } from '../types/settings'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/shared/Card'
import Dropdown from '../components/shared/Dropdown'
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
              <Dropdown
                value={settings.theme}
                onChange={(v) => patch({ theme: v })}
                options={[
                  { label: 'Light', value: 'light' },
                  { label: 'Dark', value: 'dark' },
                  { label: 'System', value: 'system' },
                ]}
              />
            }
          />
          <SettingRow
            label="Interface language"
            description="Applies to menus and captions."
            control={
              <Dropdown
                value={settings.interfaceLanguage}
                onChange={(v) => patch({ interfaceLanguage: v })}
                options={[
                  { label: 'English', value: 'en' },
                  { label: 'Filipino', value: 'fil' },
                ]}
              />
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
              <Dropdown
                value={settings.avatarSpeed}
                onChange={(v) => patch({ avatarSpeed: v })}
                options={[
                  { label: '0.75x', value: 0.75 },
                  { label: '1x', value: 1 },
                  { label: '1.25x', value: 1.25 },
                ]}
              />
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