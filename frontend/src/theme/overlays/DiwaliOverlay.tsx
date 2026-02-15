import '@/theme/overlays/DiwaliOverlay.css'

const DIYA_COUNT = 14
const SPARKLE_COUNT = 18

const DiwaliOverlay = () => {
  return (
    <div className="theme-overlay diwali-overlay" aria-hidden="true">
      <div className="diwali-glow-layer" />
      <div className="diwali-sparkle-layer">
        {Array.from({ length: SPARKLE_COUNT }, (_, index) => (
          <span key={`diwali-sparkle-${index}`} className="diwali-sparkle" />
        ))}
      </div>
      <div className="diwali-diya-layer">
        {Array.from({ length: DIYA_COUNT }, (_, index) => (
          <span key={`diwali-diya-${index}`} className="diwali-diya" />
        ))}
      </div>
    </div>
  )
}

export default DiwaliOverlay
