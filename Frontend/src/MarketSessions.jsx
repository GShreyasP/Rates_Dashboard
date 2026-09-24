import { useEffect, useState } from 'react'

// Standard FX trading sessions in UTC hours. End < start means the session
// crosses midnight UTC (Sydney).
const SESSIONS = [
  { name: 'Sydney',   tz: 'Australia/Sydney',   startUtc: 22, endUtc: 7  },
  { name: 'Tokyo',    tz: 'Asia/Tokyo',         startUtc: 0,  endUtc: 9  },
  { name: 'London',   tz: 'Europe/London',      startUtc: 7,  endUtc: 16 },
  { name: 'New York', tz: 'America/New_York',   startUtc: 13, endUtc: 22 },
]

const ROW_HEIGHT = 34
const AXIS_HEIGHT = 28
const AXIS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

function localTime(tz, now) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now).toLowerCase().replace(' ', '')
}

function isOpenNow(session, nowUtcHours) {
  const { startUtc, endUtc } = session
  if (endUtc >= startUtc) return nowUtcHours >= startUtc && nowUtcHours < endUtc
  return nowUtcHours >= startUtc || nowUtcHours < endUtc  // wraps midnight
}

export default function MarketSessions() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const nowUtc = now.getUTCHours() + now.getUTCMinutes() / 60
  const nowPct = (nowUtc / 24) * 100

  const rows = SESSIONS.map((s) => ({
    ...s,
    open: isOpenNow(s, nowUtc),
    bars: s.endUtc >= s.startUtc
      ? [{ left: s.startUtc, width: s.endUtc - s.startUtc }]
      : [
          { left: s.startUtc, width: 24 - s.startUtc },
          { left: 0,          width: s.endUtc         },
        ],
  }))

  return (
    <section style={{ marginBottom: 48 }}>
      <h2>Market Sessions</h2>
      <div className="card" style={{ padding: '20px 22px' }}>
        <div style={{ position: 'relative' }}>
          {/* Hour axis */}
          <div style={{
            position: 'relative',
            height: AXIS_HEIGHT,
            borderBottom: '1px solid #e3e8ee',
          }}>
            {AXIS_HOURS.map((h) => {
              const pct = (h / 24) * 100
              const align = h === 0 ? 'flex-start' : h === 24 ? 'flex-end' : 'center'
              return (
                <div key={h} style={{
                  position: 'absolute',
                  left: `${pct}%`,
                  top: 0,
                  height: '100%',
                  transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: align,
                  pointerEvents: 'none',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 500, color: '#697386', letterSpacing: '0.02em' }}>
                    {h === 24 ? '00' : String(h).padStart(2, '0')}:00
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
                      : 'rgba(99, 91, 255, 0.25)',
                    border: r.open ? '1px solid #4c46d1' : '1px solid rgba(99, 91, 255, 0.35)',
                    borderRadius: 4,
                  }} />
                ))}
                {/* Label */}
                <div style={{
                  position: 'absolute', left: 10, top: 0, height: '100%',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, zIndex: 2, pointerEvents: 'none',
                }}>
                  <span style={{ fontWeight: 600, color: r.open ? '#ffffff' : '#0a2540' }}>{r.name}</span>
                  <span style={{ fontWeight: 500, color: r.open ? 'rgba(255,255,255,0.85)' : '#697386' }}>
                    {localTime(r.tz, now)} local
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
            left: `${nowPct}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: '#0a2540',
            transform: 'translateX(-1px)',
            zIndex: 3,
            pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
              width: 8, height: 8, borderRadius: '50%', background: '#0a2540',
            }} />
            <div style={{
              position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
              fontSize: 10, fontWeight: 700, color: '#0a2540', letterSpacing: '0.04em',
              background: '#ffffff', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
            }}>
              {new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })
                .format(now).toLowerCase().replace(' ', '')}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
