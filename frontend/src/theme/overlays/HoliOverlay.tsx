import '@/theme/overlays/HoliOverlay.css'

const SPLASH_COUNT = 20

const HoliOverlay = () => {
  return (
    <div className="theme-overlay holi-overlay" aria-hidden="true">
      <div className="holi-glow-layer" />
      <div className="holi-splash-layer">
        {Array.from({ length: SPLASH_COUNT }, (_, index) => (
          <span key={`holi-splash-${index}`} className="holi-splash" />
        ))}
      </div>
    </div>
  )
}

export default HoliOverlay
