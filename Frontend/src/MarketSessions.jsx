import { useEffect, useState } from 'react'

// FX trading sessions defined by each city's LOCAL business hours.
// The UTC window is derived at render time from the city's current
// UTC offset, so DST shifts (BST↔GMT, EDT↔EST, AEDT↔AEST) are always
// handled correctly.
const SESSIONS = [
  { name: 'Sydney',   tz: 'Australia/Sydney', localOpen: 8, localClose: 17 },
  { name: 'Tokyo',    tz: 'Asia/Tokyo',       localOpen: 9, localClose: 18 },
  { name: 'London',   tz: 'Europe/London',    localOpen: 8, localClose: 17 },
  { name: 'New York', tz: 'America/New_York', localOpen: 8, localClose: 17 },
]

// Returns the city's current UTC offset in hours (e.g. -4 for NY EDT).
function tzOffsetHours(tz, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(date)
  const raw = parts.find(p => p.type === 'timeZoneName')?.value || ''
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(raw)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * (parseInt(m[2], 10) + parseInt(m[3] || '0', 10) / 60)
}

function normHour(h) {
  let x = h % 24
  if (x < 0) x += 24
  return x
}

const ROW_HEIGHT = 34
const AXIS_HEIGHT = 28

function localTimeString(tz, now) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now).toLowerCase().replace(' ', '')
}

// Viewer's UTC offset in hours (positive = ahead of UTC).
function viewerUtcOffsetHours() {
  // getTimezoneOffset returns minutes to add to LOCAL to reach UTC (i.e. inverse of what we want).
  return -new Date().getTimezoneOffset() / 60
}

// Given a UTC hour, return the corresponding hour on the viewer's local 24h clock (0..24).
function utcToLocalHours(utcHour, offsetH) {
  let x = (utcHour + offsetH) % 24
  if (x < 0) x += 24
  return x
}

function isOpenNow(startUtc, endUtc, nowUtcH) {
  if (endUtc > startUtc) return nowUtcH >= startUtc && nowUtcH < endUtc
  return nowUtcH >= startUtc || nowUtcH < endUtc
}

export default function MarketSessions() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const offsetH = viewerUtcOffsetHours()
  const nowUtcH = now.getUTCHours() + now.getUTCMinutes() / 60
  const nowLocalH = utcToLocalHours(nowUtcH, offsetH)
  const nowPct = (nowLocalH / 24) * 100

  // For each session, derive today's UTC window from the city's LOCAL
  // business hours + its current UTC offset. Then re-project onto the
  // viewer's local-time axis. Handles both wraps (session past city
  // midnight, session past viewer midnight).
  const rows = SESSIONS.map((s) => {
    const cityOffset = tzOffsetHours(s.tz, now)  // e.g. -4 for NY EDT
    const utcOpen  = normHour(s.localOpen  - cityOffset)
    const utcClose = normHour(s.localClose - cityOffset)
    const utcDuration = s.localClose - s.localOpen

    const localStart = normHour(utcOpen + offsetH)
    const localEnd   = normHour(localStart + utcDuration)

    const bars = localEnd > localStart
      ? [{ left: localStart, width: localEnd - localStart }]
      : [
          { left: localStart, width: 24 - localStart },
          { left: 0,          width: localEnd        },
        ]
    return {
      ...s,
      open: isOpenNow(utcOpen, utcClose, nowUtcH),
      bars,
    }
  })

  // Axis ticks: every 3 local hours 00, 03, 06 … 24 (24 mirrored as 00).
  const axisHours = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(now).find(p => p.type === 'timeZoneName')?.value || ''

  const formatAxisHour = (h) => {
    const hh = h % 24
    if (hh === 0) return '12am'
    if (hh === 12) return '12pm'
    return hh < 12 ? `${hh}am` : `${hh - 12}pm`
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <h2>Market Sessions <span style={{
        fontSize: 11, fontWeight: 500, color: '#697386', marginLeft: 8, letterSpacing: '0.04em',
      }}>Your local time · {tzAbbr}</span></h2>

      <div className="card" style={{ padding: '20px 22px' }}>
        <div style={{ position: 'relative' }}>

          {/* Hour axis */}
          <div style={{
            position: 'relative', height: AXIS_HEIGHT, borderBottom: '1px solid #e3e8ee',
          }}>
            {axisHours.map((h) => {
              const pct = (h / 24) * 100
              const shift = h === 0 ? '0' : h === 24 ? '-100%' : '-50%'
              return (
                <div key={h} style={{
                  position: 'absolute', left: `${pct}%`, top: 0, height: '100%',
                  transform: `translateX(${shift})`, pointerEvents: 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 500, color: '#697386', letterSpacing: '0.02em' }}>
                    {formatAxisHour(h)}
                  </span>
                  <span style={{ flex: 1, borderLeft: '1px solid #e3e8ee', width: 0 }} />
                </div>
              )
            })}
          </div>

          {/* Session rows */}
          <div style={{ paddingTop: 8 }}>
            {rows.map((r) => (
              <div key={r.name} style={{ position: 'relative', height: ROW_HEIGHT, marginBottom: 4 }}>
                {/* Track */}
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: 8, bottom: 8,
                  background: '#f7fafc', borderRadius: 4,
                }} />
                {/* Session bars */}
                {r.bars.map((b, i) => (
                  <div key={i} style={{
                    position: 'absolute',
                    left: `${(b.left / 24) * 100}%`,
                    width: `${(b.width / 24) * 100}%`,
                    top: 8, bottom: 8,
                    background: r.open
                      ? 'linear-gradient(180deg, #635bff 0%, #4c46d1 100%)'
                      : 'rgba(99, 91, 255, 0.22)',
                    border: r.open ? '1px solid #4c46d1' : '1px solid rgba(99, 91, 255, 0.3)',
                    borderRadius: 4,
                  }} />
                ))}
                {/* Label — always at start of first bar; falls into gutter if bar too narrow */}
                <div style={{
                  position: 'absolute',
                  left: `calc(${(r.bars[0].left / 24) * 100}% + 10px)`,
                  top: 0, height: '100%',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, zIndex: 2, pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>
                  <span style={{ fontWeight: 600, color: r.open ? '#ffffff' : '#0a2540' }}>{r.name}</span>
                  <span style={{ fontWeight: 500, color: r.open ? 'rgba(255,255,255,0.85)' : '#697386' }}>
                    {localTimeString(r.tz, now)} local
                  </span>
                  {r.open && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                      background: 'rgba(255,255,255,0.22)', color: '#fff',
                      padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
                    }}>Open</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Now indicator */}
          <div style={{
            position: 'absolute',
            left: `${nowPct}%`, top: 0, bottom: 0, width: 2,
            background: '#0a2540', transform: 'translateX(-1px)',
            zIndex: 3, pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
              width: 8, height: 8, borderRadius: '50%', background: '#0a2540',
            }} />
            <div style={{
              position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
              fontSize: 10, fontWeight: 700, color: '#0a2540', letterSpacing: '0.04em',
              background: '#ffffff', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
              border: '1px solid #e3e8ee',
            }}>
              {new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                .format(now).toLowerCase().replace(' ', '')}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
