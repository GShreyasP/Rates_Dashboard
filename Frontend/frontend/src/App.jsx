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
function InteractiveYieldChart({ originalCurve, currentYields, onYieldChange, onReset, pnl, selectedBond, onBondChange }) {
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

  // Prepare data points - only yearly maturities with even spacing
  const getDataPoints = () => {
    // Filter to only yearly maturities (1Y, 2Y, 5Y, 7Y, 10Y, 30Y)
    const yearlyCurve = originalCurve.filter(item => item.maturity.endsWith('Y'))
    const sortedCurve = [...yearlyCurve].sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity))
    
    // Find min/max yields for scaling
    const allYields = sortedCurve.map(item => currentYields[item.maturity] || item.yield)
    const minYield = Math.min(...allYields) - 0.5
    const maxYield = Math.max(...allYields) + 0.5
    
    // Use even spacing for x-axis (not proportional to years)
    const numPoints = sortedCurve.length
    
    return sortedCurve.map((item, index) => {
      const originalYield = item.yield
      const currentYield = currentYields[item.maturity] !== undefined ? currentYields[item.maturity] : originalYield
      
      // Even spacing: distribute points evenly across the plot width
      const x = margin.left + (index / (numPoints - 1)) * plotWidth
      const y = margin.top + plotHeight - ((currentYield - minYield) / (maxYield - minYield)) * plotHeight
      
      return {
        maturity: item.maturity,
        originalYield,
        currentYield,
        x,
        y,
        index
      }
    })
  }

  const dataPoints = getDataPoints()

  const handleMouseDown = (e, point) => {
    // Filter to only yearly maturities for consistent calculations
    const yearlyCurve = originalCurve.filter(item => item.maturity.endsWith('Y'))
    const sortedCurve = [...yearlyCurve].sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity))
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

  // Generate path for the yield curve (original) - only yearly with even spacing
  const getOriginalCurvePath = () => {
    if (dataPoints.length === 0) return ''
    const yearlyCurve = originalCurve.filter(item => item.maturity.endsWith('Y'))
    const sortedCurve = [...yearlyCurve].sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity))
    const allYields = sortedCurve.map(item => item.yield)
    const minYield = Math.min(...allYields) - 0.5
    const maxYield = Math.max(...allYields) + 0.5
    const numPoints = sortedCurve.length
    
    const points = sortedCurve.map((item, index) => {
      // Even spacing
      const x = margin.left + (index / (numPoints - 1)) * plotWidth
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
  
  // Get available yearly maturities for dropdown
  const availableBonds = dataPoints.map(p => p.maturity).sort((a, b) => {
    const aYears = maturityToYears(a)
    const bYears = maturityToYears(b)
    return aYears - bYears
  })

  return (
    <div className="interactive-chart-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h4 style={{ color: '#4a9eff', fontSize: '1.1rem', margin: 0 }}>
          Interactive Yield Curve & PNL Calculator
        </h4>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <label style={{ color: '#8b95b2', fontSize: '0.9rem' }}>
            Bond for PNL:
            <select
              value={selectedBond || '10Y'}
              onChange={(e) => onBondChange(e.target.value)}
              style={{
                marginLeft: '0.5rem',
                padding: '0.4rem 0.75rem',
                background: '#0f1525',
                border: '1px solid #1e2746',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              {availableBonds.map(bond => (
                <option key={bond} value={bond}>{bond}</option>
              ))}
            </select>
          </label>
          {onReset && (
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
            Estimated PNL ($10M {selectedBond || '10Y'} Position)
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
            Drag the {selectedBond || '10Y'} point up or down to see PNL impact (includes convexity adjustment)
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
  const [selectedBond, setSelectedBond] = useState('10Y')
  const [draggedPoint, setDraggedPoint] = useState(null)
  const chartRef = useRef(null)
  const [dataUpdated, setDataUpdated] = useState(false)
  const [dataUpdateMessage, setDataUpdateMessage] = useState('')
  const [tradeYields, setTradeYields] = useState({ '2Y': null, '10Y': null })

  // Explanation data for each indicator
  const indicatorExplanations = {
    "CPI": {
      what: "Measures the average change in prices paid by urban consumers for a basket of goods and services over time.",
      goodScore: "Moderate increases (2-3% annually) indicate healthy inflation. Too high (>5%) suggests overheating; too low (<1%) may signal weak demand.",
      future: "Rising CPI suggests higher costs and potential Fed rate hikes. Falling CPI may indicate economic slowdown and potential rate cuts."
    },
    "PCE Headline": {
      what: "Personal Consumption Expenditures Price Index (Headline) measures changes in prices paid by consumers for all goods and services, including food and energy.",
      goodScore: "Moderate increases (2-3% annually) indicate healthy inflation. The Fed targets 2% PCE inflation. Too high (>3%) suggests overheating; too low (<1%) may signal weak demand.",
      future: "Rising PCE is the Fed's primary inflation metric for policy decisions. Higher PCE typically leads to rate hikes; lower PCE may prompt rate cuts."
    },
    "PCE Core": {
      what: "Personal Consumption Expenditures Price Index (Core) excludes volatile food and energy prices, providing a more stable measure of underlying inflation trends.",
      goodScore: "Core PCE is the Fed's preferred inflation gauge as it excludes volatile components. The Fed targets 2% core PCE. Moderate increases (2-3% annually) indicate healthy inflation.",
      future: "Core PCE is closely watched by the Fed as it reflects underlying inflation trends without food/energy volatility. Rising core PCE typically leads to rate hikes."
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
    },
    "Consumer Sentiment": {
      what: "University of Michigan Consumer Sentiment Index measures how optimistic consumers feel about the economy and their personal finances.",
      goodScore: "Higher values indicate positive consumer sentiment. Values above 90 suggest strong consumer confidence; below 70 may signal economic concerns.",
      future: "Rising consumer sentiment supports increased spending and economic growth. Falling sentiment may signal reduced spending and economic slowdown."
    },
    "Consumer Confidence": {
      what: "Conference Board Consumer Confidence Index measures consumers' assessment of current business and labor market conditions, and expectations for the next six months.",
      goodScore: "Higher values indicate stronger consumer confidence. Values above 100 suggest optimistic consumers; below 80 may signal economic concerns.",
      future: "Rising consumer confidence supports increased spending and economic expansion. Falling confidence may signal reduced spending and potential economic slowdown."
    }
  }

  // Organize indicators by section
  const organizeIndicatorsBySection = (data) => {
    if (!data) return {}
    
    return {
      "Inflation Indicators": {
        indicators: ["CPI", "PCE Headline", "PCE Core", "PMI"].filter(key => data[key]),
        description: "Measures of consumer price inflation, spending patterns, and manufacturing activity"
      },
      "Employment Indicators": {
        indicators: ["Non-Farm Payrolls", "Unemployment Rate", "Unemployment Claims", "JOLTS"].filter(key => data[key]),
        description: "Labor market health, job creation, and labor turnover metrics"
      },
      "Price & Activity Indexes": {
        indicators: ["PPI", "Consumer Sentiment", "Consumer Confidence"].filter(key => data[key]),
        description: "Wholesale price inflation, producer cost trends, and consumer sentiment"
      }
    }
  }

  const toggleCard = (key) => {
    setExpandedCards(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // Calculate modified duration (duration adjusted for yield)
  // Modified duration decreases as yield increases (convexity effect)
  // Using approximation: Modified Duration ≈ Macaulay Duration / (1 + yield)
  const calculateModifiedDuration = (macaulayDuration, yieldPercent) => {
    return macaulayDuration / (1 + yieldPercent / 100)
  }

  // Calculate DV01 for a position at a specific yield
  // DV01 changes as yield changes because duration changes
  const calculateDV01 = (faceValue, macaulayDuration, yieldPercent) => {
    const modifiedDuration = calculateModifiedDuration(macaulayDuration, yieldPercent)
    // Approximate price at current yield (using par value as baseline)
    // Price ≈ Face Value for approximation
    return modifiedDuration * 0.0001 * faceValue
  }

  // Calculate PNL accounting for changing DV01 (convexity)
  // As yield increases, DV01 decreases (duration decreases), so PNL increases at decreasing rate
  // As yield decreases, DV01 increases (duration increases), so PNL moves faster
  const calculatePNL = (originalYield, newYield, macaulayDuration, faceValue) => {
    // Yield change in basis points
    const yieldChangeBps = (newYield - originalYield) * 100
    
    // Calculate DV01 at original yield (this is the $8000 reference)
    const originalDV01 = calculateDV01(faceValue, macaulayDuration, originalYield)
    
    // Calculate DV01 at new yield (changes due to duration change)
    const newDV01 = calculateDV01(faceValue, macaulayDuration, newYield)
    
    // Average DV01 for the move (using average gives better approximation for convexity)
    const avgDV01 = (originalDV01 + newDV01) / 2
    
    // PNL = -Average_DV01 * yield_change_in_bps
    // Negative because bond prices move inversely to yields
    // The convexity is built in because we're using average DV01 which accounts for duration change
    return -avgDV01 * yieldChangeBps
  }

  // Get Macaulay duration estimate for different maturities (approximate)
  // These are Macaulay durations (not modified durations)
  const getMacaulayDuration = (maturity) => {
    const maturityMap = {
      '1Y': 1.0,
      '2Y': 1.9,
      '5Y': 4.5,
      '7Y': 6.2,
      '10Y': 8.0,
      '30Y': 18.0
    }
    return maturityMap[maturity] || 8.0
  }

  // Get PNL for selected bond position
  const getPNL = (selectedBond = '10Y') => {
    if (!ratesData || !interactiveYields || !ratesData.yield_curve) {
      console.log('PNL calc: Missing data', { ratesData: !!ratesData, interactiveYields: !!interactiveYields })
      return 0
    }
    
    const originalBond = ratesData.yield_curve.find(item => item.maturity === selectedBond)
    if (!originalBond) {
      console.log(`PNL calc: No ${selectedBond} found in yield curve`)
      return 0
    }
    
    const newYield = interactiveYields[selectedBond]
    if (newYield === undefined) {
      console.log(`PNL calc: No ${selectedBond} in interactive yields`, interactiveYields)
      return 0
    }
    
    // Calculate PNL for $10M position
    const macaulayDuration = getMacaulayDuration(selectedBond)
    const faceValue = 10000000
    
    // Calculate original DV01 (reference point, should be ~$8000 for 10Y)
    const originalDV01 = calculateDV01(faceValue, macaulayDuration, originalBond.yield)
    
    // Calculate PNL with convexity (DV01 changes with yield)
    const pnl = calculatePNL(originalBond.yield, newYield, macaulayDuration, faceValue)
    
    // Calculate new DV01 for reference
    const newDV01 = calculateDV01(faceValue, macaulayDuration, newYield)
    
    console.log('PNL calculated:', { 
      bond: selectedBond, 
      originalYield: originalBond.yield, 
      newYield: newYield,
      yieldChangeBps: (newYield - originalBond.yield) * 100,
      macaulayDuration,
      originalDV01,
      newDV01,
      pnl 
    })
    return pnl
  }

  // Determine API URL 
  // - Development: localhost
  // - Production on Vercel: use relative paths (/api)
  // - Production with separate backend: use VITE_API_URL env var
  const API_URL = import.meta.env.DEV 
    ? 'http://localhost:5001/api' 
    : (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api');

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('Fetching data from:', API_URL)
        // Fetch all endpoints in parallel for faster loading
        const [macroRes, ratesRes, fedwatchRes] = await Promise.all([
          axios.get(`${API_URL}/macro`).catch(err => {
            console.error("Error fetching macro data:", err.response?.data || err.message)
            return { data: null, error: err }
          }),
          axios.get(`${API_URL}/rates`).catch(err => {
            console.error("Error fetching rates data:", err.response?.data || err.message)
            return { data: null, error: err }
          }),
          axios.get(`${API_URL}/fedwatch`).catch(err => {
            console.warn("FedWatch data not available:", err.response?.data || err.message)
            return { data: null }
          })
        ])
        
        // Log what we received
        console.log('Macro data response:', macroRes.data)
        console.log('Rates data response:', ratesRes.data)
        console.log('FedWatch data response:', fedwatchRes.data)
        
        // Check for errors in response data
        if (macroRes.data?.error) {
          console.error("Macro API returned error:", macroRes.data.error)
        }
        if (ratesRes.data?.error) {
          console.error("Rates API returned error:", ratesRes.data.error)
        }
        
        // Only set data if we got valid responses (not errors)
        if (macroRes.data && !macroRes.error) {
          setMacroData(macroRes.data)
        } else {
          console.warn("Macro data not set due to error")
        }
        if (ratesRes.data && !ratesRes.error) {
          setRatesData(ratesRes.data)
        } else {
          console.warn("Rates data not set due to error")
        }
        if (fedwatchRes.data) {
          setFedwatchData(fedwatchRes.data)
        }
        
        // Initialize interactive yields with current rates data (only yearly maturities)
        if (ratesRes.data && ratesRes.data.yield_curve && Array.isArray(ratesRes.data.yield_curve) && ratesRes.data.yield_curve.length > 0) {
          const yields = {}
          ratesRes.data.yield_curve
            .filter(item => item.maturity && item.maturity.endsWith('Y')) // Only yearly maturities
            .forEach(item => {
              yields[item.maturity] = item.yield
            })
          setInteractiveYields(yields)
          console.log('Interactive yields initialized:', yields)
        } else {
          console.warn('No yield curve data available for interactive chart', {
            hasData: !!ratesRes.data,
            hasYieldCurve: !!ratesRes.data?.yield_curve,
            isArray: Array.isArray(ratesRes.data?.yield_curve),
            length: ratesRes.data?.yield_curve?.length
          })
        }
        setLoading(false)
      } catch (error) {
        console.error("Error fetching data", error)
        console.error("Error details:", {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          config: error.config
        })
        setLoading(false)
      }
    }
    fetchData()
    
    // Poll for data updates every 30 seconds
    const pollInterval = setInterval(async () => {
      try {
        const updateRes = await axios.get(`${API_URL}/data-updated`)
        if (updateRes.data.updated && Object.keys(updateRes.data.updated_data).length > 0) {
          const updatedTypes = Object.keys(updateRes.data.updated_data).join(', ')
          setDataUpdateMessage(`New data available for: ${updatedTypes}. Please reload to see updates.`)
          setDataUpdated(true)
        }
      } catch (error) {
        // Silently fail - don't interrupt user experience
        console.log("Error checking for data updates:", error)
      }
    }, 30000) // Check every 30 seconds
    
    return () => clearInterval(pollInterval)
  }, [])

  if (loading) return (
    <div className="loading" style={{ position: 'relative', height: '100vh' }}>
      <div style={{ fontSize: '1.5rem', color: '#4a9eff' }}>Loading Market Data...</div>
      <div style={{
        position: 'absolute',
        bottom: '2rem',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '0.75rem 1.5rem',
        background: 'rgba(74, 158, 255, 0.1)',
        border: '1px solid rgba(74, 158, 255, 0.3)',
        borderRadius: '8px',
        fontSize: '0.9rem',
        color: '#8b95b2',
        fontStyle: 'italic',
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
      }}>
        Loading market data (optimized for faster load times)
      </div>
    </div>
  )

  const handleReload = () => {
    window.location.reload()
  }

  return (
    <div className="dashboard-container">
      {dataUpdated && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          background: 'rgba(74, 222, 128, 0.15)',
          border: '2px solid rgba(74, 222, 128, 0.5)',
          borderRadius: '8px',
          padding: '1rem 1.5rem',
          color: '#4ade80',
          zIndex: 1000,
          maxWidth: '400px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>🔄 Data Updated</div>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>{dataUpdateMessage}</div>
          </div>
          <button
            onClick={handleReload}
            style={{
              padding: '0.5rem 1rem',
              background: '#4ade80',
              border: 'none',
              borderRadius: '4px',
              color: '#0f1525',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.85rem'
            }}
            onMouseOver={(e) => e.target.style.background = '#4ade80'}
            onMouseOut={(e) => e.target.style.background = '#4ade80'}
          >
            Reload
          </button>
          <button
            onClick={() => setDataUpdated(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#4ade80',
              cursor: 'pointer',
              fontSize: '1.2rem',
              padding: '0.25rem 0.5rem'
            }}
          >
            ×
          </button>
        </div>
      )}
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
                          <span className={(data.yoy_change !== undefined ? data.yoy_change : data.change) >= 0 ? 'green' : 'red'}>
                            {(data.yoy_change !== undefined ? data.yoy_change : data.change) > 0 ? '▲' : '▼'} 
                            {data.yoy_change !== undefined ? `${data.yoy_change}%` : `${data.change}%`}
                            {data.yoy_change !== undefined && <span style={{fontSize: '0.75rem', marginLeft: '0.25rem', opacity: 0.7}}>YoY</span>}
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
            <h3>Target Rate Probabilities for {fedwatchData.next_meeting_date ? fedwatchData.next_meeting_date + ' Fed Meeting' : 'Next Fed Meeting'}</h3>
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

          {/* Interactive Yield Curve & PNL Calculator */}
          <div className="card">
            {ratesData && ratesData.yield_curve ? (
              interactiveYields ? (
                <InteractiveYieldChart 
                  originalCurve={ratesData.yield_curve}
                  currentYields={interactiveYields}
                  selectedBond={selectedBond}
                  onBondChange={(bond) => setSelectedBond(bond)}
                  onYieldChange={(maturity, newYield) => {
                    setInteractiveYields(prev => ({
                      ...prev,
                      [maturity]: newYield
                    }))
                  }}
                  onReset={() => {
                    const yields = {}
                    ratesData.yield_curve
                      .filter(item => item.maturity.endsWith('Y')) // Only yearly maturities
                      .forEach(item => {
                        yields[item.maturity] = item.yield
                      })
                    setInteractiveYields(yields)
                  }}
                  pnl={getPNL(selectedBond)}
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

          {/* BEAR STEEPENER TRADE PITCH */}
          <div className="card" style={{ gridColumn: '1 / -1', marginTop: '2rem' }}>
            <h3 style={{ color: '#4a9eff', marginBottom: '1.5rem' }}>Bear Steepener Trade: Short 10Y / Long 2Y</h3>
            
            {/* Interactive 2Y vs 10Y Chart */}
            {ratesData && ratesData.yield_curve && ratesData.yields ? (() => {
              // Use interactive yields if set, otherwise use original data
              const yield2Y = tradeYields['2Y'] !== null ? tradeYields['2Y'] : (ratesData.yields['2Y'] || 0);
              const yield10Y = tradeYields['10Y'] !== null ? tradeYields['10Y'] : (ratesData.yields['10Y'] || 0);
              const original2Y = ratesData.yields['2Y'] || 0;
              const original10Y = ratesData.yields['10Y'] || 0;
              const spread = yield10Y - yield2Y;
              const originalSpread = original10Y - original2Y;
              const spreadChange = (spread - originalSpread) * 100; // in bps
              
              // Calculate DV01 for $10M positions
              const dv01_2Y = 1.9 * 0.0001 * 10_000_000; // 2Y duration ~1.9
              const dv01_10Y = 8.0 * 0.0001 * 10_000_000; // 10Y duration ~8.0
              
              // For duration-neutral trade, calculate position sizes
              // Short $10M 10Y, Long $X 2Y where X * dv01_2Y = 10M * dv01_10Y
              const long2YNotional = (10_000_000 * dv01_10Y) / dv01_2Y;
              
              // Calculate actual P&L based on current yield changes
              const yield2YChange = (yield2Y - original2Y) * 100; // in bps
              const yield10YChange = (yield10Y - original10Y) * 100; // in bps
              
              // P&L calculation: Short 10Y loses when 10Y rises, Long 2Y gains when 2Y falls
              const pnl_10Y_leg = -yield10YChange * (dv01_10Y / 100); // Short position
              const pnl_2Y_leg = -yield2YChange * (dv01_2Y * long2YNotional / 10_000_000 / 100); // Long position
              const totalPnl = pnl_10Y_leg + pnl_2Y_leg;
              
              // P&L scenarios (for display)
              const pnl_10Y_up_1bp = -dv01_10Y; // Short loses
              const pnl_2Y_down_1bp = dv01_2Y * (long2YNotional / 10_000_000); // Long gains
              const pnl_spread_widen_10bps = 10 * (dv01_10Y + (dv01_2Y * long2YNotional / 10_000_000));
              
              const chartData = [
                { maturity: '2Y', yield: yield2Y, color: '#4ade80', originalYield: original2Y },
                { maturity: '10Y', yield: yield10Y, color: '#f87171', originalYield: original10Y }
              ];
              
              return (
                <div>
                  {/* Interactive Chart */}
                  <div style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ color: '#8b95b2', fontSize: '0.9rem' }}>2Y Yield:</label>
                          <input
                            type="number"
                            step="0.01"
                            value={yield2Y.toFixed(2)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                setTradeYields(prev => ({ ...prev, '2Y': val }));
                              }
                            }}
                            style={{
                              width: '80px',
                              padding: '0.25rem 0.5rem',
                              background: '#1e2746',
                              border: '1px solid #4a9eff',
                              borderRadius: '4px',
                              color: '#e0e0e0',
                              fontSize: '0.9rem'
                            }}
                          />
                          <span style={{ color: '#8b95b2', fontSize: '0.85rem' }}>%</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ color: '#8b95b2', fontSize: '0.9rem' }}>10Y Yield:</label>
                          <input
                            type="number"
                            step="0.01"
                            value={yield10Y.toFixed(2)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                setTradeYields(prev => ({ ...prev, '10Y': val }));
                              }
                            }}
                            style={{
                              width: '80px',
                              padding: '0.25rem 0.5rem',
                              background: '#1e2746',
                              border: '1px solid #f87171',
                              borderRadius: '4px',
                              color: '#e0e0e0',
                              fontSize: '0.9rem'
                            }}
                          />
                          <span style={{ color: '#8b95b2', fontSize: '0.85rem' }}>%</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setTradeYields({ '2Y': null, '10Y': null })}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#1e2746',
                          border: '1px solid #4a9eff',
                          borderRadius: '4px',
                          color: '#4a9eff',
                          cursor: 'pointer',
                          fontSize: '0.85rem'
                        }}
                      >
                        Reset to Current
                      </button>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart 
                        data={chartData}
                        onMouseDown={(e) => {
                          if (e && e.activeLabel) {
                            const maturity = e.activeLabel;
                            const chart = e.chart;
                            const activeCoordinate = e.activeCoordinate;
                            if (chart && activeCoordinate) {
                              // Calculate yield from Y coordinate
                              const yAxis = chart.yAxisMap[0];
                              const yValue = yAxis.scale.invert(activeCoordinate.y);
                              setTradeYields(prev => ({ ...prev, [maturity]: yValue }));
                            }
                          }
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e2746" />
                        <XAxis 
                          dataKey="maturity" 
                          stroke="#8b95b2"
                          tick={{ fill: '#8b95b2', fontSize: 14, fontWeight: 'bold' }}
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
                          formatter={(value, name, props) => {
                            const change = props.payload.maturity === '2Y' 
                              ? ((value - original2Y) * 100).toFixed(1)
                              : ((value - original10Y) * 100).toFixed(1);
                            return [
                              `${value.toFixed(2)}% (${change > 0 ? '+' : ''}${change} bps)`,
                              'Yield'
                            ];
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="yield" 
                          stroke="#4a9eff" 
                          strokeWidth={3}
                          dot={(props) => {
                            const { cx, cy, payload } = props;
                            const isChanged = (payload.maturity === '2Y' && Math.abs(payload.yield - original2Y) > 0.001) ||
                                            (payload.maturity === '10Y' && Math.abs(payload.yield - original10Y) > 0.001);
                            return (
                              <g>
                                <circle 
                                  cx={cx} 
                                  cy={cy} 
                                  r={10} 
                                  fill={payload.color || '#4a9eff'}
                                  stroke={isChanged ? '#4ade80' : '#fff'}
                                  strokeWidth={isChanged ? 3 : 2}
                                  style={{ cursor: 'pointer' }}
                                />
                                {isChanged && (
                                  <circle 
                                    cx={cx} 
                                    cy={cy} 
                                    r={12} 
                                    fill="none"
                                    stroke="#4ade80"
                                    strokeWidth={2}
                                    strokeDasharray="4 4"
                                    opacity={0.6}
                                  />
                                )}
                              </g>
                            );
                          }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-around', 
                      marginTop: '1rem',
                      padding: '1rem',
                      background: 'rgba(74, 158, 255, 0.05)',
                      borderRadius: '6px'
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#8b95b2', fontSize: '0.85rem' }}>2Y Yield</div>
                        <div style={{ color: '#4ade80', fontSize: '1.1rem', fontWeight: 'bold' }}>
                          {yield2Y.toFixed(2)}%
                          {Math.abs(yield2Y - original2Y) > 0.001 && (
                            <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                              ({((yield2Y - original2Y) * 100) > 0 ? '+' : ''}{((yield2Y - original2Y) * 100).toFixed(1)} bps)
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#8b95b2', fontSize: '0.85rem' }}>10Y Yield</div>
                        <div style={{ color: '#f87171', fontSize: '1.1rem', fontWeight: 'bold' }}>
                          {yield10Y.toFixed(2)}%
                          {Math.abs(yield10Y - original10Y) > 0.001 && (
                            <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                              ({((yield10Y - original10Y) * 100) > 0 ? '+' : ''}{((yield10Y - original10Y) * 100).toFixed(1)} bps)
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#8b95b2', fontSize: '0.85rem' }}>2s10s Spread</div>
                        <div style={{ color: '#4a9eff', fontSize: '1.1rem', fontWeight: 'bold' }}>
                          {(spread * 100).toFixed(2)} bps
                          {Math.abs(spreadChange) > 0.1 && (
                            <span style={{ 
                              fontSize: '0.9rem', 
                              marginLeft: '0.5rem',
                              color: spreadChange > 0 ? '#4ade80' : '#f87171'
                            }}>
                              ({spreadChange > 0 ? '+' : ''}{spreadChange.toFixed(1)} bps)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Trade Structure & DV01 */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
                    gap: '1rem',
                    marginBottom: '2rem'
                  }}>
                    <div style={{ 
                      padding: '1rem', 
                      background: 'rgba(74, 222, 128, 0.1)', 
                      border: '1px solid rgba(74, 222, 128, 0.3)',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95b2', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Long Position</div>
                      <div style={{ color: '#4ade80', fontSize: '1.2rem', fontWeight: 'bold' }}>2Y Treasury</div>
                      <div style={{ color: '#e0e0e0', marginTop: '0.5rem' }}>Notional: ${(long2YNotional / 1_000_000).toFixed(2)}M</div>
                      <div style={{ color: '#8b95b2', fontSize: '0.9rem', marginTop: '0.25rem' }}>DV01: ${(dv01_2Y * long2YNotional / 10_000_000).toLocaleString()}</div>
                    </div>
                    
                    <div style={{ 
                      padding: '1rem', 
                      background: 'rgba(248, 113, 113, 0.1)', 
                      border: '1px solid rgba(248, 113, 113, 0.3)',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95b2', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Short Position</div>
                      <div style={{ color: '#f87171', fontSize: '1.2rem', fontWeight: 'bold' }}>10Y Treasury</div>
                      <div style={{ color: '#e0e0e0', marginTop: '0.5rem' }}>Notional: $10.00M</div>
                      <div style={{ color: '#8b95b2', fontSize: '0.9rem', marginTop: '0.25rem' }}>DV01: ${dv01_10Y.toLocaleString()}</div>
                    </div>
                    
                    <div style={{ 
                      padding: '1rem', 
                      background: Math.abs(totalPnl) > 0.01 ? (totalPnl > 0 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)') : 'rgba(74, 158, 255, 0.1)', 
                      border: `1px solid ${Math.abs(totalPnl) > 0.01 ? (totalPnl > 0 ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)') : 'rgba(74, 158, 255, 0.3)'}`,
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#8b95b2', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                        {Math.abs(totalPnl) > 0.01 ? 'Current P&L' : 'P&L Scenarios'}
                      </div>
                      {Math.abs(totalPnl) > 0.01 ? (
                        <div style={{ 
                          color: totalPnl > 0 ? '#4ade80' : '#f87171', 
                          fontSize: '1.3rem', 
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}>
                          {totalPnl > 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      ) : (
                        <div style={{ color: '#e0e0e0', fontSize: '0.9rem', lineHeight: '1.6' }}>
                          <div>10Y ↑1bp, 2Y flat: <span style={{ color: '#4ade80' }}>+${Math.abs(pnl_10Y_up_1bp + pnl_2Y_down_1bp).toLocaleString()}</span></div>
                          <div>2Y ↓1bp, 10Y flat: <span style={{ color: '#4ade80' }}>+${Math.abs(pnl_2Y_down_1bp).toLocaleString()}</span></div>
                          <div>Spread widens 10bps: <span style={{ color: '#4ade80' }}>+${Math.abs(pnl_spread_widen_10bps).toLocaleString()}</span></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Trade Explanation */}
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ color: '#4a9eff', marginBottom: '1rem' }}>The Trade</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(74, 158, 255, 0.05)', 
                      border: '1px solid rgba(74, 158, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#e0e0e0',
                      lineHeight: '1.8'
                    }}>
                      <p style={{ marginBottom: '1rem' }}>
                        <strong style={{ color: '#4a9eff' }}>Action:</strong> Short the 10-year Treasury Note (sell futures) and Long the 2-year Treasury Note (buy futures).
                      </p>
                      <p style={{ marginBottom: '1rem' }}>
                        <strong style={{ color: '#4a9eff' }}>Target:</strong> Current 2s10s spread is {(spread * 100).toFixed(0)} bps. Target a widening to +100 bps as the "term premium" returns to historical norms.
                      </p>
                      <p>
                        <strong style={{ color: '#4a9eff' }}>Duration Neutrality:</strong> Position is weighted by DV01 to ensure this is a "curve play" and not just a bet on direction. The trade profits from curve steepening regardless of parallel rate moves.
                      </p>
                    </div>
                  </div>

                  {/* Why This Trade */}
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ color: '#4a9eff', marginBottom: '1rem' }}>Why This Trade: The "Hawkish Easing" Cycle</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(74, 158, 255, 0.05)', 
                      border: '1px solid rgba(74, 158, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#e0e0e0',
                      lineHeight: '1.8'
                    }}>
                      <p style={{ marginBottom: '1rem' }}>
                        Based on market data from late December 2025, we are witnessing a unique "Hawkish Easing" cycle. The Federal Reserve recently delivered a 25bps cut (bringing the target to 3.50%–3.75%), but coupled it with a "dot plot" that signaled only one more cut for all of 2026.
                      </p>
                      <p style={{ marginBottom: '1rem' }}>
                        This has resulted in a <strong style={{ color: '#4a9eff' }}>Bear Steepening</strong> of the yield curve. While short-term rates are drifting lower due to the actual cuts, long-term yields (10Y and 30Y) are rising as investors demand a higher "term premium" to compensate for persistent inflation risks (Core PCE at 2.8%) and massive Treasury supply.
                      </p>
                      
                      <div style={{ marginTop: '1.5rem' }}>
                        <h5 style={{ color: '#4a9eff', marginBottom: '0.75rem' }}>The Thesis</h5>
                        <div style={{ marginLeft: '1rem' }}>
                          <p style={{ marginBottom: '0.75rem' }}>
                            <strong style={{ color: '#4ade80' }}>The Front End is Anchored:</strong> The Fed has entered a "wait and see" mode. Even if they don't cut aggressively, the 2-year yield is unlikely to spike because the hiking cycle is definitively over.
                          </p>
                          <p style={{ marginBottom: '0.75rem' }}>
                            <strong style={{ color: '#f87171' }}>The Back End is Unbound:</strong> Several factors are pushing long-term yields higher:
                          </p>
                          <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                            <li><strong>Fiscal Deficits:</strong> Continued high government spending is increasing the supply of long-dated bonds, requiring higher yields to attract buyers.</li>
                            <li><strong>Inflation Stickiness:</strong> With Core PCE at 2.8% and new potential tariffs on the horizon, the market is losing faith that inflation will return to the 2% target soon.</li>
                            <li><strong>BOJ Normalization:</strong> The Bank of Japan just raised rates to 0.75%, which may cause Japanese investors (the largest foreign holders of US Treasuries) to repatriate capital, putting further upward pressure on US long-end yields.</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Risk Factors */}
                  <div>
                    <h4 style={{ color: '#f87171', marginBottom: '1rem' }}>Risk Factors</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(248, 113, 113, 0.05)', 
                      border: '1px solid rgba(248, 113, 113, 0.2)',
                      borderRadius: '6px',
                      color: '#e0e0e0',
                      lineHeight: '1.8'
                    }}>
                      <p>
                        <strong style={{ color: '#f87171' }}>The "Bull Flattener" Risk:</strong> If a sudden recessionary shock occurs (e.g., unemployment spikes toward 5%), the Fed would likely slash rates aggressively. In that scenario, the 2-year would crash much faster than the 10-year, causing the curve to "Bull Steepen" instead. While you still profit from the widening spread, the "Short 10Y" leg would lose money on a nominal basis.
                      </p>
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#8b95b2' }}>
                Loading trade data...
              </div>
            )}
          </div>

        </div>
      </section>
    </div>
  )
}

export default App