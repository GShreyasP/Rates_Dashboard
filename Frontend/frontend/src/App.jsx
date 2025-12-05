import { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import './App.css'

// Helper function to convert maturity string to years
const maturityToYears = (maturity) => {
  if (maturity.endsWith('W')) {
    return parseInt(maturity.slice(0, -1)) / 52.0
  } else if (maturity.endsWith('M')) {
    return parseInt(maturity.slice(0, -1)) / 12.0
  } else if (maturity.endsWith('Y')) {
    return parseFloat(maturity.slice(0, -1))
  }
  return 0
}

// Interactive Yield Chart Component
function InteractiveYieldChart({ originalCurve, currentYields, onYieldChange, onReset, pnl }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [isDragging, setIsDragging] = useState(null)
  const [chartWidth, setChartWidth] = useState(700)
  const dragStateRef = useRef({ startY: 0, startYield: 0, maturity: null, minYield: 0, maxYield: 0, plotHeight: 0 })

  const chartHeight = 350
  const margin = { top: 20, right: 30, bottom: 60, left: 60 }
  const plotWidth = chartWidth - margin.left - margin.right
  const plotHeight = chartHeight - margin.top - margin.bottom

  // Make chart responsive
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth
        setChartWidth(Math.min(700, containerWidth - 32)) // 32px for padding
      }
    }
    
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Prepare data points
  const getDataPoints = () => {
    const sortedCurve = [...originalCurve].sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity))
    
    // Find min/max yields for scaling
    const allYields = sortedCurve.map(item => currentYields[item.maturity] || item.yield)
    const minYield = Math.min(...allYields) - 0.5
    const maxYield = Math.max(...allYields) + 0.5
    
    return sortedCurve.map((item) => {
      const years = maturityToYears(item.maturity)
      const originalYield = item.yield
      const currentYield = currentYields[item.maturity] !== undefined ? currentYields[item.maturity] : originalYield
      
      // Convert to pixel coordinates
      const maxYears = Math.max(...sortedCurve.map(i => maturityToYears(i.maturity)))
      const x = margin.left + (years / maxYears) * plotWidth
      const y = margin.top + plotHeight - ((currentYield - minYield) / (maxYield - minYield)) * plotHeight
      
      return {
        maturity: item.maturity,
        years,
        originalYield,
        currentYield,
        x,
        y
      }
    })
  }

  const dataPoints = getDataPoints()

  const handleMouseDown = (e, point) => {
    const sortedCurve = [...originalCurve].sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity))
    const allYields = sortedCurve.map(item => currentYields[item.maturity] || item.yield)
    const minYield = Math.min(...allYields) - 0.5
    const maxYield = Math.max(...allYields) + 0.5
    
    dragStateRef.current = {
      startY: e.clientY,
      startYield: point.currentYield,
      maturity: point.maturity,
      minYield,
      maxYield,
      plotHeight
    }
    setIsDragging(point.maturity)
    e.preventDefault()
  }


  // Add global event listeners
  useEffect(() => {
    const handleMouseMoveGlobal = (e) => {
      if (!isDragging || !svgRef.current || !dragStateRef.current.maturity) return
      
      const { startY, startYield, maturity, minYield, maxYield, plotHeight: plotH } = dragStateRef.current
      const pixelsPerYield = plotH / (maxYield - minYield)
      
      const deltaY = (startY - e.clientY) / pixelsPerYield
      const newYield = Math.max(0, Math.min(20, startYield + deltaY))
      
      onYieldChange(maturity, newYield)
    }

    const handleMouseUpGlobal = () => {
      setIsDragging(null)
      dragStateRef.current.maturity = null
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMoveGlobal)
      window.addEventListener('mouseup', handleMouseUpGlobal)
      return () => {
        window.removeEventListener('mousemove', handleMouseMoveGlobal)
        window.removeEventListener('mouseup', handleMouseUpGlobal)
      }
    }
  }, [isDragging, onYieldChange])

  // Calculate yield range for Y-axis
  const allYields = dataPoints.map(p => p.currentYield)
  const minYield = Math.min(...allYields) - 0.5
  const maxYield = Math.max(...allYields) + 0.5

  // Generate Y-axis labels
  const yAxisTicks = 5
  const yAxisLabels = []
  for (let i = 0; i <= yAxisTicks; i++) {
    const yieldValue = minYield + (maxYield - minYield) * (i / yAxisTicks)
    yAxisLabels.push(yieldValue.toFixed(2))
  }

  // Generate path for the yield curve (original)
  const getOriginalCurvePath = () => {
    if (dataPoints.length === 0) return ''
    const sortedCurve = [...originalCurve].sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity))
    const allYields = sortedCurve.map(item => item.yield)
    const minYield = Math.min(...allYields) - 0.5
    const maxYield = Math.max(...allYields) + 0.5
    const maxYears = Math.max(...sortedCurve.map(i => maturityToYears(i.maturity)))
    
    const points = sortedCurve.map((item) => {
      const years = maturityToYears(item.maturity)
      const x = margin.left + (years / maxYears) * plotWidth
      const y = margin.top + plotHeight - ((item.yield - minYield) / (maxYield - minYield)) * plotHeight
      return `${x},${y}`
    }).join(' L ')
    return `M ${points}`
  }

  // Generate path for the current yield curve
  const getCurvePath = () => {
    if (dataPoints.length === 0) return ''
    const points = dataPoints.map(p => `${p.x},${p.y}`).join(' L ')
    return `M ${points}`
  }

  const hasChanges = dataPoints.some(p => Math.abs(p.currentYield - p.originalYield) > 0.01)

  return (
    <div className="interactive-chart-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h4 style={{ color: '#4a9eff', fontSize: '1.1rem', margin: 0 }}>
          Interactive Yield Curve & PNL Calculator
        </h4>
        {hasChanges && onReset && (
          <button
            onClick={onReset}
            style={{
              padding: '0.5rem 1rem',
              background: '#1e2746',
              border: '1px solid #4a9eff',
              borderRadius: '4px',
              color: '#4a9eff',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
            onMouseOver={(e) => {
              e.target.style.background = '#4a9eff'
              e.target.style.color = '#fff'
            }}
            onMouseOut={(e) => {
              e.target.style.background = '#1e2746'
              e.target.style.color = '#4a9eff'
            }}
          >
            Reset to Original
          </button>
        )}
      </div>
      <div 
        ref={containerRef}
        style={{ 
          background: '#0f1525', 
          borderRadius: '6px', 
          padding: '1rem',
          border: '1px solid #1e2746'
        }}
      >
        <svg 
          ref={svgRef}
          width={chartWidth} 
          height={chartHeight}
          style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
          onMouseLeave={() => {
            setIsDragging(null)
            dragStateRef.current.maturity = null
          }}
        >
          {/* Grid lines */}
          {yAxisLabels.map((label, i) => {
            const y = margin.top + (plotHeight / yAxisTicks) * i
            return (
              <line
                key={`grid-${i}`}
                x1={margin.left}
                y1={y}
                x2={margin.left + plotWidth}
                y2={y}
                stroke="#1e2746"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )
          })}
          
          {/* Y-axis labels */}
          {yAxisLabels.map((label, i) => {
            const y = margin.top + (plotHeight / yAxisTicks) * i
            return (
              <text
                key={`y-label-${i}`}
                x={margin.left - 10}
                y={y + 5}
                fill="#8b95b2"
                fontSize="11"
                textAnchor="end"
              >
                {label}%
              </text>
            )
          })}
          
          {/* X-axis labels */}
          {dataPoints.map((point, i) => (
            <text
              key={`x-label-${i}`}
              x={point.x}
              y={chartHeight - margin.bottom + 20}
              fill="#8b95b2"
              fontSize="11"
              textAnchor="middle"
            >
              {point.maturity}
            </text>
          ))}

          {/* Original yield curve (dashed line) */}
          <path
            d={getOriginalCurvePath()}
            fill="none"
            stroke="#4a9eff"
            strokeWidth="2"
            strokeDasharray="5 5"
            opacity="0.4"
          />

          {/* Current yield curve (solid line) */}
          <path
            d={getCurvePath()}
            fill="none"
            stroke="#4a9eff"
            strokeWidth="3"
          />

          {/* Interactive points */}
          {dataPoints.map((point, i) => {
            const isChanged = Math.abs(point.currentYield - point.originalYield) > 0.01
            return (
              <g key={point.maturity}>
                {/* Line to point */}
                <line
                  x1={point.x}
                  y1={margin.top + plotHeight}
                  x2={point.x}
                  y2={point.y}
                  stroke="#1e2746"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                {/* Draggable point */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={8}
                  fill={isChanged ? "#4ade80" : "#4a9eff"}
                  stroke="#fff"
                  strokeWidth="2"
                  style={{ cursor: 'ns-resize' }}
                  onMouseDown={(e) => handleMouseDown(e, point)}
                />
                {/* Yield label above point */}
                <text
                  x={point.x}
                  y={point.y - 15}
                  fill={isChanged ? "#4ade80" : "#4a9eff"}
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {point.currentYield.toFixed(2)}%
                </text>
                {/* Change indicator */}
                {isChanged && (
                  <text
                    x={point.x}
                    y={point.y - 30}
                    fill="#4ade80"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {point.currentYield > point.originalYield ? '▲' : '▼'} 
                    {Math.abs(point.currentYield - point.originalYield).toFixed(2)}%
                  </text>
                )}
              </g>
            )
          })}

          {/* Axis labels */}
          <text
            x={chartWidth / 2}
            y={chartHeight - 10}
            fill="#8b95b2"
            fontSize="12"
            textAnchor="middle"
          >
            Maturity
          </text>
          <text
            x={15}
            y={chartHeight / 2}
            fill="#8b95b2"
            fontSize="12"
            textAnchor="middle"
            transform={`rotate(-90, 15, ${chartHeight / 2})`}
          >
            Yield (%)
          </text>
        </svg>
        
        {/* PNL Display */}
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: pnl >= 0 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
          border: `1px solid ${pnl >= 0 ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
          borderRadius: '6px',
          textAlign: 'center'
        }}>
          <div style={{
            color: '#8b95b2',
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Estimated PNL ($10M 10Y Position)
          </div>
          <div style={{
            color: pnl >= 0 ? '#4ade80' : '#f87171',
            fontSize: '2rem',
            fontWeight: 'bold',
            fontFamily: 'Courier New, monospace'
          }}>
            {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{
            color: '#8b95b2',
            fontSize: '0.85rem',
            marginTop: '0.5rem',
            fontStyle: 'italic'
          }}>
            Drag the 10Y point up or down to see PNL impact
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [macroData, setMacroData] = useState(null)
  const [ratesData, setRatesData] = useState(null)
  const [fedwatchData, setFedwatchData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedCards, setExpandedCards] = useState({})
  const [interactiveYields, setInteractiveYields] = useState(null)
  const [draggedPoint, setDraggedPoint] = useState(null)
  const chartRef = useRef(null)

  // Explanation data for each indicator
  const indicatorExplanations = {
    "CPI": {
      what: "Measures the average change in prices paid by urban consumers for a basket of goods and services over time.",
      goodScore: "Moderate increases (2-3% annually) indicate healthy inflation. Too high (>5%) suggests overheating; too low (<1%) may signal weak demand.",
      future: "Rising CPI suggests higher costs and potential Fed rate hikes. Falling CPI may indicate economic slowdown and potential rate cuts."
    },
    "PCE": {
      what: "Personal Consumption Expenditures Price Index measures changes in prices paid by consumers for goods and services. The Fed's preferred inflation gauge.",
      goodScore: "Moderate increases (2-3% annually) indicate healthy inflation. The Fed targets 2% PCE inflation. Too high (>3%) suggests overheating; too low (<1%) may signal weak demand.",
      future: "Rising PCE is the Fed's primary inflation metric for policy decisions. Higher PCE typically leads to rate hikes; lower PCE may prompt rate cuts."
    },
    "PPI": {
      what: "Measures average changes in selling prices received by domestic producers for their output, tracking inflation at the wholesale level.",
      goodScore: "Stable or moderate increases (1-3%) indicate balanced supply chains. Sharp increases suggest cost pressures; declines may signal weak demand.",
      future: "Rising PPI often precedes CPI increases, signaling future consumer price inflation. Falling PPI may indicate deflationary pressures ahead."
    },
    "Non-Farm Payrolls": {
      what: "Total number of paid U.S. workers in non-farm establishments, excluding government, private households, and non-profit employees.",
      goodScore: "Consistent monthly growth (150K-250K) indicates healthy job market. Declines signal economic weakness; very high growth may indicate overheating.",
      future: "Strong payroll growth supports consumer spending and economic expansion. Weak growth suggests potential recession and Fed easing."
    },
    "Unemployment Rate": {
      what: "Percentage of the labor force that is unemployed and actively seeking employment. A key measure of labor market slack.",
      goodScore: "Lower is generally better. Rates below 4% indicate tight labor market. Rates above 6% suggest economic weakness. The Fed targets 'full employment' around 4-5%.",
      future: "Falling unemployment supports wage growth and consumer spending, potentially leading to rate hikes. Rising unemployment signals economic weakness and potential rate cuts."
    },
    "Unemployment Claims": {
      what: "Number of individuals filing for unemployment insurance benefits, indicating layoffs and labor market health.",
      goodScore: "Lower is better. Claims below 250K indicate strong job market. Above 300K suggests labor market weakness.",
      future: "Rising claims signal economic slowdown and potential Fed easing. Falling claims support economic strength and potential rate hikes."
    },
    "JOLTS": {
      what: "Job Openings and Labor Turnover Survey (JOLTS) measures job openings, hires, and separations. Job openings indicate labor demand.",
      goodScore: "Higher job openings relative to unemployed workers (ratio >1.0) indicates tight labor market. Declining openings suggest weakening labor demand.",
      future: "High job openings support wage growth and economic strength, potentially leading to rate hikes. Declining openings signal economic slowdown and potential rate cuts."
    },
    "PMI": {
      what: "Purchasing Managers' Index measuring manufacturing activity. Values above 50 indicate expansion; below 50 indicates contraction.",
      goodScore: "Values above 50 indicate manufacturing growth. Above 55 suggests strong expansion; below 45 signals significant contraction.",
      future: "Rising PMI suggests economic strength and potential rate hikes. Falling PMI indicates weakening economy and potential rate cuts."
    }
  }

  // Organize indicators by section
  const organizeIndicatorsBySection = (data) => {
    if (!data) return {}
    
    return {
      "Consumer Price Indicators": {
        indicators: ["CPI", "PCE"].filter(key => data[key]),
        description: "Measures of consumer price inflation and spending patterns"
      },
      "Employment Indicators": {
        indicators: ["Non-Farm Payrolls", "Unemployment Rate", "Unemployment Claims", "JOLTS"].filter(key => data[key]),
        description: "Labor market health, job creation, and labor turnover metrics"
      },
      "Price & Activity Indexes": {
        indicators: ["PPI", "PMI"].filter(key => data[key]),
        description: "Wholesale price inflation, producer cost trends, and manufacturing activity"
      }
    }
  }

  const toggleCard = (key) => {
    setExpandedCards(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // Calculate DV01 for a position
  const calculateDV01 = (faceValue, duration, yieldPercent) => {
    return duration * 0.0001 * faceValue
  }

  // Calculate PNL based on yield change and DV01
  const calculatePNL = (originalYield, newYield, dv01) => {
    // Yield change in basis points
    const yieldChangeBps = (newYield - originalYield) * 100
    // PNL = -DV01 * yield_change_in_bps
    // Negative because bond prices move inversely to yields
    return -dv01 * yieldChangeBps
  }

  // Get PNL for the 10Y position
  const getPNL = () => {
    if (!ratesData || !interactiveYields || !ratesData.yield_curve) {
      console.log('PNL calc: Missing data', { ratesData: !!ratesData, interactiveYields: !!interactiveYields })
      return 0
    }
    
    const original10Y = ratesData.yield_curve.find(item => item.maturity === '10Y')
    if (!original10Y) {
      console.log('PNL calc: No 10Y found in yield curve')
      return 0
    }
    
    const new10Y = interactiveYields['10Y']
    if (new10Y === undefined) {
      console.log('PNL calc: No 10Y in interactive yields', interactiveYields)
      return 0
    }
    
    // Calculate DV01 for $10M 10Y position (duration ~8 years)
    const dv01 = calculateDV01(10000000, 8.0, new10Y)
    const pnl = calculatePNL(original10Y.yield, new10Y, dv01)
    console.log('PNL calculated:', { original: original10Y.yield, new: new10Y, dv01, pnl })
    return pnl
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
        // Initialize interactive yields with current rates data
        if (ratesRes.data && ratesRes.data.yield_curve) {
          const yields = {}
          ratesRes.data.yield_curve.forEach(item => {
            yields[item.maturity] = item.yield
          })
          setInteractiveYields(yields)
          console.log('Interactive yields initialized:', yields)
        } else {
          console.warn('No yield curve data available for interactive chart')
        }
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
        {macroData && (() => {
          const sections = organizeIndicatorsBySection(macroData)
          return Object.entries(sections).map(([sectionName, section]) => {
            if (section.indicators.length === 0) return null
            
            return (
              <div key={sectionName} className="indicator-section">
                <div className="section-header">
                  <h3>{sectionName}</h3>
                  <p className="section-description">{section.description}</p>
                </div>
                <div className="charts-grid">
                  {section.indicators.map((key) => {
                    const data = macroData[key]
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
                    )
                  })}
                </div>
              </div>
            )
          })
        })()}
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
                      domain={[3, 'auto']}
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
            
            {/* Interactive Bond Trade Chart */}
            {ratesData && ratesData.yield_curve ? (
              interactiveYields ? (
                <InteractiveYieldChart 
                  originalCurve={ratesData.yield_curve}
                  currentYields={interactiveYields}
                  onYieldChange={(maturity, newYield) => {
                    setInteractiveYields(prev => ({
                      ...prev,
                      [maturity]: newYield
                    }))
                  }}
                  onReset={() => {
                    const yields = {}
                    ratesData.yield_curve.forEach(item => {
                      yields[item.maturity] = item.yield
                    })
                    setInteractiveYields(yields)
                  }}
                  pnl={getPNL()}
                />
              ) : (
                <div style={{ 
                  padding: '2rem', 
                  textAlign: 'center', 
                  color: '#8b95b2',
                  fontStyle: 'italic'
                }}>
                  Initializing interactive chart...
                </div>
              )
            ) : (
              <div style={{ 
                padding: '2rem', 
                textAlign: 'center', 
                color: '#8b95b2',
                fontStyle: 'italic'
              }}>
                Loading yield curve data...
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default App