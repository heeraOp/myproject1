import './RunGame.css'

const numbers = Array.from({ length: 90 }, (_, i) => i + 1)

const prizeList = [
  'First Full House',
  'Second Full House',
  'Full Sheet Bonus',
  'Half Sheet Bonus',
  'Bottom Line',
  'Middle Line',
  'Top Line',
  'Star',
  'Quick7',
]

const RunGame = () => {
  return (
    <div className="run-shell">
      <header className="run-title">RUN GAME</header>
      <div className="run-time">13:1:44</div>

      <div className="run-controls">
        <div className="control-row">
          <span>CALLING STATUS</span>
          <div className="control-value">OFF</div>
        </div>
        <div className="control-row">
          <span>CALLING INTERVAL</span>
          <div className="control-value">12s</div>
        </div>
      </div>

      <div className="number-grid">
        {numbers.map((num) => (
          <div className="number-cell" key={num}>
            {num}
          </div>
        ))}
      </div>

      <div className="prize-panel">
        {prizeList.map((label) => (
          <div className="prize-row" key={label}>
            <span>{label}</span>
            <span className="prize-check">[]</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default RunGame
