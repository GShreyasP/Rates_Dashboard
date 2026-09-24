import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[UI error]', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        maxWidth: 640, margin: '80px auto', padding: 32,
        background: '#ffffff', border: '1px solid #e3e8ee',
        borderRadius: 10, fontFamily: 'Inter, system-ui, sans-serif',
        color: '#0a2540',
      }}>
        <div style={{fontSize: 12, fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#b42318', marginBottom: 12}}>
          Something broke
        </div>
        <h2 style={{fontSize: 22, fontWeight: 600, marginBottom: 12, letterSpacing: '-0.01em'}}>
          The dashboard couldn’t render this view.
        </h2>
        <p style={{color: '#697386', fontSize: 14, marginBottom: 20, lineHeight: 1.6}}>
          One of the data feeds returned something unexpected. The rest of the app is fine — reload to try again.
        </p>
        <pre style={{
          background: '#f7fafc', border: '1px solid #e3e8ee', borderRadius: 6,
          padding: 12, fontSize: 12, color: '#425466', overflowX: 'auto',
          fontFamily: 'SF Mono, ui-monospace, monospace',
        }}>{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 16, padding: '8px 16px', background: '#635bff', color: '#fff',
          border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
        }}>Reload</button>
      </div>
    )
  }
}
