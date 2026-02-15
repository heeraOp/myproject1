import { useTheme, type AppTheme } from '@/theme/ThemeContext'

const THEME_OPTIONS: Array<{ value: AppTheme; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'diwali', label: 'Diwali' },
  { value: 'holi', label: 'Holi' },
]

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()

  return (
    <div className="theme-toggle-card">
      <label className="theme-toggle-label" htmlFor="theme-select">
        Theme
      </label>
      <select
        id="theme-select"
        className="theme-toggle-select"
        value={theme}
        onChange={(event) => setTheme(event.target.value as AppTheme)}
      >
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export default ThemeToggle
