import { useEffect, useState } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import './App.css'

function App() {
  const [macroData, setMacroData] = useState(null)
  const [ratesData, setRatesData] = useState(null)
  const [fedwatchData, setFedwatchData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedCards, setExpandedCards] = useState({})

  // Explanation data for each indicator
  const indicatorExplanations = {
    "CPI": {
      what: "Measures the average change in prices paid by urban consumers for a basket of goods and services over time.",
      goodScore: "Moderate increases (2-3% annually) indicate healthy inflation. Too high (>5%) suggests overheating; too low (<1%) may signal weak demand.",
      future: "Rising CPI suggests higher costs and potential Fed rate hikes. Falling CPI may indicate economic slowdown and potential rate cuts."
    },
    "PPI": {
      what: "Measures average changes in selling prices received by domestic producers for their output, tracking inflation at the wholesale level.",
      goodScore: "Stable or moderate increases (1-3%) indicate balanced supply chains. Sharp increases suggest cost pressures; declines may signal weak demand.",
      future: "Rising PPI often precedes CPI increases, signaling future consumer price inflation. Falling PPI may indicate deflationary pressures ahead."
    },
    "Payrolls": {
      what: "Total number of paid U.S. workers in non-farm establishments, excluding government, private households, and non-profit employees.",
      goodScore: "Consistent monthly growth (150K-250K) indicates healthy job market. Declines signal economic weakness; very high growth may indicate overheating.",
      future: "Strong payroll growth supports consumer spending and economic expansion. Weak growth suggests potential recession and Fed easing."
    },
    "PMI": {
      what: "Purchasing Managers' Index measuring manufacturing activity. Values above 50 indicate expansion; below 50 indicates contraction.",
      goodScore: "Values above 50 indicate manufacturing growth. Above 55 suggests strong expansion; below 45 signals significant contraction.",
      future: "Rising PMI suggests economic strength and potential rate hikes. Falling PMI indicates weakening economy and potential rate cuts."
    },
    "Unemployment Claims": {
      what: "Number of individuals filing for unemployment insurance benefits, indicating layoffs and labor market health.",
      goodScore: "Lower is better. Claims below 250K indicate strong job market. Above 300K suggests labor market weakness.",
      future: "Rising claims signal economic slowdown and potential Fed easing. Falling claims support economic strength and potential rate hikes."
    }
  }

  const toggleCard = (key) => {
    setExpandedCards(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // Determine API URL (Localhost for dev, env variable for prod, or relative path)
  const API_URL = import.meta.env.DEV 
    ? 'http://localhost:5001/api' 
    : (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch all endpoints in parallel for faster loading
        const [macroRes, ratesRes, fedwatchRes] = await Promise.all([
          axios.get(`${API_URL}/macro`),
          axios.get(`${API_URL}/rates`),
          axios.get(`${API_URL}/fedwatch`).catch(err => {
            console.warn("FedWatch data not available:", err)
            return { data: null }
          })
        ])
        setMacroData(macroRes.data)
        setRatesData(ratesRes.data)
        setFedwatchData(fedwatchRes.data)
        setLoading(false)
      } catch (error) {
        console.error("Error fetching data", error)
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) return <div className="loading">Loading Market Data...</div>

  return (
    <div className="dashboard-container">
      <header>
        <h1>Rates Dashboard</h1>
        <p>Macro Data • Yield Curve • Trade Pitches</p>
      </header>

      {/* SECTION 1: MACRO DATA */}
      <section className="macro-section">
        <h2>Economic Indicators</h2>
        <div className="charts-grid">
          {macroData && Object.entries(macroData).map(([key, data]) => {
            // Format data for chart - data structure now has 'value' and 'pct_change'
            const chartData = data.history ? data.history.map(item => ({
              date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
              value: item.value,
              pct_change: item.pct_change || 0,
              fullDate: item.date
            })) : [];
            
            return (
              <div key={key} className="card">
                <h3>{key}</h3>
                <div className="stat-row">
                  <span>Latest: <strong>{data.current?.toLocaleString()}</strong></span>
                  <span className={data.change >= 0 ? 'green' : 'red'}>
                    {data.change > 0 ? '▲' : '▼'} {data.change}%
                  </span>
                </div>
                <div className="chart-wrapper">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e2746" />
                        <XAxis 
                          dataKey="date" 
                          stroke="#8b95b2"
                          tick={{ fill: '#8b95b2', fontSize: 10 }}
                          angle={-45}
                          textAnchor="end"
                          height={60}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          stroke="#8b95b2"
                          tick={{ fill: '#8b95b2', fontSize: 10 }}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#141b2d', 
                            border: '1px solid #1e2746',
                            color: '#e0e0e0'
                          }}
                          labelStyle={{ color: '#4a9eff' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="value" 
                          stroke="#4a9eff" 
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: '#4a9eff' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#8b95b2' }}>
                      No data available
                    </div>
                  )}
                </div>
                {/* Horizontal Data Table */}
                {chartData.length > 0 && (
                  <div className="data-table-wrapper">
                    <div className="data-table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Value</th>
                            <th>% Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chartData.slice().reverse().map((item, idx) => (
                            <tr key={idx}>
                              <td>{item.date}</td>
                              <td>{typeof item.value === 'number' ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : item.value}</td>
                              <td className={item.pct_change >= 0 ? 'green' : 'red'}>
                                {item.pct_change > 0 ? '▲' : item.pct_change < 0 ? '▼' : ''} {item.pct_change.toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* Explanation Dropdown */}
                <div className="explanation-section">
                  <button 
                    className="explanation-toggle"
                    onClick={() => toggleCard(key)}
                    aria-expanded={expandedCards[key]}
                  >
                    <span>ℹ️ About {key}</span>
                    <span className="toggle-icon">{expandedCards[key] ? '▼' : '▶'}</span>
                  </button>
                  {expandedCards[key] && indicatorExplanations[key] && (
                    <div className="explanation-content">
                      <div className="explanation-item">
                        <h4>What It Measures</h4>
                        <p>{indicatorExplanations[key].what}</p>
                      </div>
                      <div className="explanation-item">
                        <h4>What's a Good Score</h4>
                        <p>{indicatorExplanations[key].goodScore}</p>
                      </div>
                      <div className="explanation-item">
                        <h4>What It Means for the Future</h4>
                        <p>{indicatorExplanations[key].future}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 2: RATES & PITCHES */}
      <section className="rates-section">
        <h2>Yield Curve & Analysis</h2>
        
        {/* FEDWATCH DATA */}
        {fedwatchData && !fedwatchData.error && (
          <div className="fedwatch-card">
            <h3>Target Rate Probabilities for {fedwatchData.next_meeting_date || 'Next Fed Meeting'}</h3>
            {fedwatchData.current_target_rate && (
              <div className="fedwatch-note" style={{background: 'rgba(74, 158, 255, 0.15)', borderColor: 'rgba(74, 158, 255, 0.4)'}}>
                <span className="note-icon">📊</span>
                <span>Current target rate is {fedwatchData.current_target_rate} bps</span>
              </div>
            )}
            {fedwatchData.note && (
              <div className="fedwatch-note">
                <span className="note-icon">ℹ️</span>
                <span>{fedwatchData.note}</span>
              </div>
            )}
            <div className="fedwatch-content">
              {fedwatchData.current_fed_rate !== undefined && (
                <div className="fedwatch-meeting">
                  <span className="fedwatch-label">Current Fed Funds Rate:</span>
                  <span className="fedwatch-value">{fedwatchData.current_fed_rate}%</span>
                </div>
              )}
              {fedwatchData.target_rate_probabilities && Object.keys(fedwatchData.target_rate_probabilities).length > 0 && (
                <div className="fedwatch-chart-wrapper">
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart 
                      data={Object.entries(fedwatchData.target_rate_probabilities)
                        .sort((a, b) => {
                          const aVal = parseInt(a[0].split('-')[0]);
                          const bVal = parseInt(b[0].split('-')[0]);
                          return aVal - bVal;
                        })
                        .map(([range, prob]) => ({
                          range: range,
                          probability: prob
                        }))}
                      margin={{ top: 20, right: 50, left: 20, bottom: 80 }}
                      barCategoryGap="30%"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2746" />
                      <XAxis 
                        dataKey="range" 
                        stroke="#8b95b2"
                        tick={{ fill: '#8b95b2', fontSize: 12 }}
                        label={{ value: 'Target Rate (in bps)', position: 'insideBottom', offset: -5, fill: '#8b95b2' }}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis 
                        domain={[0, 100]}
                        stroke="#8b95b2"
                        tick={{ fill: '#8b95b2', fontSize: 12 }}
                        label={{ value: 'Probability', angle: -90, position: 'insideLeft', fill: '#8b95b2' }}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#141b2d', 
                          border: '1px solid #1e2746',
                          color: '#e0e0e0'
                        }}
                        labelStyle={{ color: '#4a9eff' }}
                        formatter={(value) => [`${value}%`, 'Probability']}
                      />
                      <Bar 
                        dataKey="probability" 
                        fill="#4a9eff"
                        radius={[4, 4, 0, 0]}
                        label={{ position: 'top', fill: '#fff', fontSize: 14, fontWeight: 'bold' }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {fedwatchData.most_likely_change && fedwatchData.most_likely_probability !== undefined && (
                <div className="fedwatch-probability">
                  <span className="fedwatch-label">Most Likely Target Rate:</span>
                  <span className="fedwatch-value highlight">
                    {fedwatchData.most_likely_change} bps
                    <span className="probability-badge">{fedwatchData.most_likely_probability}%</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        
        <div className="yield-curve-grid">
          {/* YIELD CURVE CHART */}
          <div className="card yield-curve-card">
            <h3>Yield Curve</h3>
            {ratesData && ratesData.yield_curve && ratesData.yield_curve.length > 0 ? (
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={ratesData.yield_curve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2746" />
                    <XAxis 
                      dataKey="maturity" 
                      stroke="#8b95b2"
                      tick={{ fill: '#8b95b2', fontSize: 12 }}
                      label={{ value: 'Maturity', position: 'insideBottom', offset: -5, fill: '#8b95b2' }}
                    />
                    <YAxis 
                      domain={['auto', 'auto']}
                      stroke="#8b95b2"
                      tick={{ fill: '#8b95b2', fontSize: 12 }}
                      label={{ value: 'Yield (%)', angle: -90, position: 'insideLeft', fill: '#8b95b2' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#141b2d', 
                        border: '1px solid #1e2746',
                        color: '#e0e0e0'
                      }}
                      labelStyle={{ color: '#4a9eff' }}
                      formatter={(value) => [`${value.toFixed(2)}%`, 'Yield']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="yield" 
                      stroke="#4a9eff" 
                      strokeWidth={3}
                      dot={{ r: 5, fill: '#4a9eff' }}
                      activeDot={{ r: 7, fill: '#4ade80' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#8b95b2' }}>
                No yield data available
              </div>
            )}
          </div>
        </div>

        <div className="analysis-grid">
          {/* YIELD CURVE TABLE */}
          <div className="card">
            <h3>Live Treasury Yields</h3>
            <table>
              <thead>
                <tr>
                  <th>Maturity</th>
                  <th>Yield (%)</th>
                </tr>
              </thead>
              <tbody>
                {ratesData && ratesData.yield_curve && ratesData.yield_curve.map((item) => (
                  <tr key={item.maturity}>
                    <td>{item.maturity}</td>
                    <td>{item.yield.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* TRADE PITCH */}
          <div className="card pitch-card">
            <h3>Desk Pitch & Risk</h3>
            <div className="pitch-content">
              <div className="metric">
                <label>Curve Shape</label>
                <div className="value">{ratesData?.analysis.curve_shape}</div>
              </div>
              <div className="metric">
                <label>2s10s Spread</label>
                <div className="value">{ratesData?.analysis.spread_2s10s} bps</div>
              </div>
              <div className="metric highlight">
                <label>Trade Idea</label>
                <div className="value">{ratesData?.analysis.trade_pitch}</div>
              </div>
              <hr />
              <div className="metric">
                <label>DV01 ($10M 10Y)</label>
                <div className="value mono">{ratesData?.analysis.dv01_10m_position}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default App