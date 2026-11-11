import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../services/api/settingsService'
import { AppSettings } from '../types/settings'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/shared/Card'
import Dropdown from '../components/shared/Dropdown'
import SettingsNav from '../components/settings/SettingsNav'
import SettingRow from '../components/settings/SettingRow'
import Toggle from '../components/settings/Toggle'
import { DEFAULT_RECOGNITION_SETTINGS, getRecognitionSettings, RECOGNITION_SETTING_LIMITS, updateRecognitionSettings } from '../services/recognitionSettings'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsUnavailable, setSettingsUnavailable] = useState(false)
  const [recognition, setRecognition] = useState(getRecognitionSettings)

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettingsUnavailable(true))
  }, [])

  function patch(partial: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...partial }
    setSettings(next) // optimistic update
    updateSettings(partial)
  }

  return (
    <div>
      <PageHeader title="Settings" description="Tune how SignSync looks, sounds, and responds to you." />
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav onSelect={section => {
          if (section === 'Recognition') document.getElementById('recognition-settings')?.focus()
        }} />
        <div className="min-w-0 space-y-4">
          <section id="recognition-settings" aria-labelledby="recognition-settings-heading" tabIndex={-1}>
            <Card className="space-y-4">
              <div>
                <h2 id="recognition-settings-heading" className="text-lg font-semibold text-ink">Recognition</h2>
                <p className="text-sm text-text-2">Applies to Live Conversation when you start a new run.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block min-w-0 space-y-1 text-sm">
                  <span className="flex flex-wrap justify-between gap-x-2 font-semibold">
                    <span>Minimum confidence</span>
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {recognition.minimumConfidence === DEFAULT_RECOGNITION_SETTINGS.minimumConfidence && <span className="text-xs font-normal text-text-2">Default</span>}
                      {recognition.minimumConfidence}%
                    </span>
                  </span>
                  <input type="range" {...RECOGNITION_SETTING_LIMITS.minimumConfidence}
                    aria-label="Minimum confidence" aria-valuetext={`${recognition.minimumConfidence} percent`}
                    aria-describedby="recognition-confidence-help" className="block w-full accent-signal"
                    value={recognition.minimumConfidence}
                    onChange={event => setRecognition(updateRecognitionSettings({ minimumConfidence: event.currentTarget.valueAsNumber }))} />
                  <span id="recognition-confidence-help" className="block text-xs text-text-2">Each model’s own acceptance rules also apply.</span>
                </label>
                <label className="block min-w-0 space-y-1 text-sm">
                  <span className="flex flex-wrap justify-between gap-x-2 font-semibold">
                    <span>Acceptance speed</span>
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {recognition.acceptanceMs === DEFAULT_RECOGNITION_SETTINGS.acceptanceMs && <span className="text-xs font-normal text-text-2">Default</span>}
                      {recognition.acceptanceMs} ms
                    </span>
                  </span>
                  <input type="range" {...RECOGNITION_SETTING_LIMITS.acceptanceMs}
                    aria-label="Acceptance speed" aria-valuetext={`${recognition.acceptanceMs} milliseconds`}
                    aria-describedby="recognition-speed-help" className="block w-full accent-signal"
                    value={recognition.acceptanceMs}
                    onChange={event => setRecognition(updateRecognitionSettings({ acceptanceMs: event.currentTarget.valueAsNumber }))} />
                  <span id="recognition-speed-help" className="block text-xs text-text-2">Lower values require a shorter span of agreeing predictions.</span>
                </label>
              </div>
            </Card>
          </section>
          {settingsUnavailable && <p role="alert" className="text-sm text-text-2">Other settings could not load.</p>}
          {settings && <Card>
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
          </Card>}
        </div>
      </div>
    </div>
  )
}
