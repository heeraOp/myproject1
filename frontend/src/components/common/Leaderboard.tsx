import React from 'react'
import './Leaderboard.css'

export type LeaderboardEntry = {
  user_id: string
  username: string
  total_marked: number
  remaining_for_full_house: number
  remaining_for_half_seat: number
}

type LeaderboardProps = {
  entries: LeaderboardEntry[]
}

const Leaderboard = React.memo(function Leaderboard({ entries }: LeaderboardProps) {
  return (
    <section className="leaderboard-card">
      <h2>Live Leaderboard</h2>
      <div className="leaderboard-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Marked</th>
              <th>Full House Left</th>
              <th>Half-Seat Left</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5}>No leaderboard data yet.</td>
              </tr>
            )}
            {entries.map((entry, index) => (
              <tr key={entry.user_id || `${entry.username}-${index}`}>
                <td>#{index + 1}</td>
                <td>{entry.username || 'Player'}</td>
                <td>{entry.total_marked}</td>
                <td>{entry.remaining_for_full_house}</td>
                <td>{entry.remaining_for_half_seat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
})

export default Leaderboard
