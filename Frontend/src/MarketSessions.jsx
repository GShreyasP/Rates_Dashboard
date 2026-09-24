import { useEffect, useState } from 'react'

// Standard FX trading sessions expressed in UTC. End < start ⇒ session
// spans midnight UTC.
const SESSIONS = [
  { name: 'Sydney',   tz: 'Australia/Sydney',   startUtc: 22, endUtc: 7  },
  { name: 'Tokyo',    tz: 'Asia/Tokyo',         startUtc: 0,  endUtc: 9  },
  { name: 'London',   tz: 'Europe/London',      startUtc: 7,  endUtc: 16 },
  { name: 'New York', tz: 'America/New_York',   startUtc: 13, endUtc: 22 },
]

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

function isOpenNow(session, nowUtcH) {
  const { startUtc, endUtc } = session
  if (endUtc >= startUtc) return nowUtcH >= startUtc && nowUtcH < endUtc
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

  // Position sessions on a LOCAL 24h axis. Convert their UTC window to local
  // and split into two pieces if it wraps past local midnight.
  const rows = SESSIONS.map((s) => {
    const localStart = utcToLocalHours(s.startUtc, offsetH)
    const utcDuration = s.endUtc >= s.startUtc ? (s.endUtc - s.startUtc) : (24 - s.startUtc + s.endUtc)
    const localEnd = (localStart + utcDuration) % 24
    let bars
    if (localEnd >= localStart) {
      bars = [{ left: localStart, width: localEnd - localStart }]
    } else {
      bars = [
        { left: localStart, width: 24 - localStart },
        { left: 0,          width: localEnd        },
      ]
    }
    return {
      ...s,
      open: isOpenNow(s, nowUtcH),
      bars,
      labelStart: localStart, // where to try to draw the label
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
