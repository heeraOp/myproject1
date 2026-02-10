import './SelectTicket.css'

const tickets = Array.from({ length: 60 }, (_, i) => i + 1)

const SelectTicket = () => {
  return (
    <div className="select-shell">
      <div className="select-header">
        <h1>SELECT TICKET</h1>
        <div className="select-close">×</div>
      </div>

      <div className="select-banner">
        <span>You can open full dashboard</span>
        <button className="banner-button">FULL DASHBOARD</button>
      </div>

      <div className="input-row">
        <input placeholder="Name" />
        <input placeholder="Phone" />
      </div>

      <div className="ticket-types">
        <div>Random ticket</div>
        <div>Halfsheet ticket</div>
        <div>Fullsheet ticket</div>
      </div>

      <div className="ticket-add">
        <input placeholder="Enter TNO" />
        <button>ADD</button>
      </div>

      <button className="book-now">BOOK NOW</button>

      <div className="ticket-grid">
        {tickets.map((num) => (
          <div className={`ticket-cell ${num % 3 === 0 ? 'available' : ''}`} key={num}>
            {num}
          </div>
        ))}
      </div>
    </div>
  )
}

export default SelectTicket
