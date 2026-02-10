import './TicketAgentList.css'

const rows = [
  { tno: 1, name: 'usham sana', phone: 'usham sana' },
  { tno: 2, name: 'usham sana', phone: 'usham sana' },
  { tno: 3, name: 'usham sana', phone: 'usham sana' },
  { tno: 4, name: 'usham sana', phone: 'usham sana' },
  { tno: 5, name: 'usham sana', phone: 'usham sana' },
  { tno: 6, name: 'usham sana', phone: 'usham sana' },
  { tno: 7, name: 'Sinthangambi', phone: 'dggfty' },
  { tno: 8, name: 'Sinthangambi', phone: 'dggfty' },
  { tno: 9, name: 'Sinthangambi', phone: 'dggfty' },
  { tno: 18, name: 'vikash', phone: 'gygu' },
  { tno: 19, name: 'bijarani', phone: 'effgg' },
  { tno: 20, name: 'bijarani', phone: 'effgg' },
  { tno: 21, name: 'bijarani', phone: 'effgg' },
  { tno: 22, name: 'bijarani', phone: 'effgg' },
  { tno: 23, name: 'bijarani', phone: 'effgg' },
  { tno: 24, name: 'bijarani', phone: 'effgg' },
  { tno: 25, name: 'sure houseful🙏', phone: 'sure houseful🙏' },
  { tno: 26, name: 'sure houseful🙏', phone: 'sure houseful🙏' },
]

const TicketAgentList = () => {
  return (
    <div className="list-shell">
      <header className="list-header">TICKET/AGENT LIST</header>

      <div className="list-tabs">
        <button className="tab active">TICKET LIST</button>
        <button className="tab">AGENT LIST</button>
      </div>

      <input className="search-input" placeholder="Enter keyword" />

      <div className="list-table">
        <div className="list-head">
          <div>TNO</div>
          <div>NAME</div>
          <div>PHONE</div>
          <div>EDIT</div>
        </div>
        {rows.map((row) => (
          <div className="list-row" key={`${row.tno}-${row.name}`}>
            <div>{row.tno}</div>
            <div>{row.name}</div>
            <div>{row.phone}</div>
            <div className="edit">EDT</div>
          </div>
        ))}
      </div>

      <button className="book-ticket">BOOK TICKET</button>
    </div>
  )
}

export default TicketAgentList
