import { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from 'recharts'
import './App.css'

// Maturities shown on the interactive PNL chart (whitelist keeps it uncluttered).
const CALC_MATURITIES = ['1M', '6M', '1Y', '2Y', '5Y', '7Y', '10Y', '30Y']
const isCalcMaturity = (m) => CALC_MATURITIES.includes(m)

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
        // Use full available width, minimum 400px
        setChartWidth(Math.max(400, containerWidth - 32)) // 32px for padding
      }
    }
    
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Prepare data points - only yearly maturities with even spacing
  const getDataPoints = () => {
    const yearlyCurve = originalCurve.filter(item => isCalcMaturity(item.maturity))
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
    const yearlyCurve = originalCurve.filter(item => isCalcMaturity(item.maturity))
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

  // Generate path for the yield curve (original) - whitelist with even spacing
  const getOriginalCurvePath = () => {
    if (dataPoints.length === 0) return ''
    const yearlyCurve = originalCurve.filter(item => isCalcMaturity(item.maturity))
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
        <h4 style={{ color: '#635bff', fontSize: '1.1rem', margin: 0 }}>
          Interactive Yield Curve & PNL Calculator
        </h4>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <label style={{ color: '#697386', fontSize: '0.9rem' }}>
            Bond for PNL:
            <select
              value={selectedBond || '10Y'}
              onChange={(e) => onBondChange(e.target.value)}
              style={{
                marginLeft: '0.5rem',
                padding: '0.4rem 0.75rem',
                background: '#f7fafc',
                border: '1px solid #e3e8ee',
                borderRadius: '4px',
                color: '#0a2540',
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
                background: '#e3e8ee',
                border: '1px solid #635bff',
                borderRadius: '4px',
                color: '#635bff',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
              onMouseOver={(e) => {
                e.target.style.background = '#635bff'
                e.target.style.color = '#fff'
              }}
              onMouseOut={(e) => {
                e.target.style.background = '#e3e8ee'
                e.target.style.color = '#635bff'
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
          background: '#f7fafc', 
          borderRadius: '6px', 
          padding: '1rem',
          border: '1px solid #e3e8ee'
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
                stroke="#e3e8ee"
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
                fill="#697386"
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
              fill="#697386"
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
            stroke="#635bff"
            strokeWidth="2"
            strokeDasharray="5 5"
            opacity="0.4"
          />

          {/* Current yield curve (solid line) */}
          <path
            d={getCurvePath()}
            fill="none"
            stroke="#635bff"
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
                  stroke="#e3e8ee"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                {/* Draggable point */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={8}
                  fill={isChanged ? "#067647" : "#635bff"}
                  stroke="#fff"
                  strokeWidth="2"
                  style={{ cursor: 'ns-resize' }}
                  onMouseDown={(e) => handleMouseDown(e, point)}
                />
                {/* Yield label above point */}
                <text
                  x={point.x}
                  y={point.y - 15}
                  fill={isChanged ? "#067647" : "#635bff"}
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
                    fill="#067647"
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
            fill="#697386"
            fontSize="12"
            textAnchor="middle"
          >
            Maturity
          </text>
          <text
            x={15}
            y={chartHeight / 2}
            fill="#697386"
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
          background: pnl >= 0 ? 'rgba(6, 118, 71, 0.1)' : 'rgba(180, 35, 24, 0.1)',
          border: `1px solid ${pnl >= 0 ? 'rgba(6, 118, 71, 0.3)' : 'rgba(180, 35, 24, 0.3)'}`,
          borderRadius: '6px',
          textAlign: 'center'
        }}>
          <div style={{
            color: '#697386',
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Estimated PNL ($10M {selectedBond || '10Y'} Position)
          </div>
          <div style={{
            color: pnl >= 0 ? '#067647' : '#f87171',
            fontSize: '2rem',
            fontWeight: 'bold',
            fontFamily: 'Courier New, monospace'
          }}>
            {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{
            color: '#697386',
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
  const [selectedMeetingIdx, setSelectedMeetingIdx] = useState(0)
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
        indicators: ["CPI", "PCE Headline", "PCE Core", "PPI"].filter(key => data[key]),
        description: "Measures of consumer price inflation, spending patterns, and manufacturing activity"
      },
      "Employment Indicators": {
        indicators: ["Non-Farm Payrolls", "Unemployment Rate", "Unemployment Claims", "JOLTS"].filter(key => data[key]),
        description: "Labor market health, job creation, and labor turnover metrics"
      },
      "Price & Activity Indexes": {
        indicators: ["PMI", "Consumer Sentiment", "Consumer Confidence"].filter(key => data[key]),
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
    // T-bills (< 1Y) have effectively no coupon reinvestment, so duration ≈ time to maturity.
    const maturityMap = {
      '1M': 1 / 12,
      '3M': 3 / 12,
      '6M': 0.5,
      '1Y': 1.0,
      '2Y': 1.9,
      '5Y': 4.5,
      '7Y': 6.2,
      '10Y': 8.0,
      '20Y': 14.0,
      '30Y': 18.0,
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

  // Vercel serves both frontend and /api. Use relative paths.
  // For local dev, run `vercel dev` (not `vite dev`) so /api works, or set VITE_API_URL.
  const API_URL = import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api';

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
            .filter(item => item.maturity && (item.maturity.endsWith('Y') || item.maturity.endsWith('M'))) // Yearly and monthly maturities
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
      <div style={{ fontSize: '1.5rem', color: '#635bff' }}>Loading Market Data...</div>
      <div style={{
        position: 'absolute',
        bottom: '2rem',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '0.75rem 1.5rem',
        background: 'rgba(99, 91, 255, 0.1)',
        border: '1px solid rgba(99, 91, 255, 0.3)',
        borderRadius: '8px',
        fontSize: '0.9rem',
        color: '#697386',
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
          background: 'rgba(6, 118, 71, 0.15)',
          border: '2px solid rgba(6, 118, 71, 0.5)',
          borderRadius: '8px',
          padding: '1rem 1.5rem',
          color: '#067647',
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
              background: '#067647',
              border: 'none',
              borderRadius: '4px',
              color: '#f7fafc',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.85rem'
            }}
            onMouseOver={(e) => e.target.style.background = '#067647'}
            onMouseOut={(e) => e.target.style.background = '#067647'}
          >
            Reload
          </button>
          <button
            onClick={() => setDataUpdated(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#067647',
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
                      date: new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                      value: item.value,
                      previous: item.previous,
                      pct_change: item.pct_change || 0,
                      forecast: (typeof item.forecast === 'number') ? item.forecast : null,
                      forecast_source: item.forecast_source || null,
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
                          {chartData.length > 0 ? (() => {
                            const isRateNative = key === 'Unemployment Rate'
                            const barKey = isRateNative ? 'value' : 'pct_change'
                            const suffix = '%'
                            const barData = chartData.slice(-24)  // last ~2 years for legibility
                            return (
                            <ResponsiveContainer width="100%" height={200}>
                              <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} />
                                <XAxis
                                  dataKey="date"
                                  stroke="#697386"
                                  tick={{ fill: '#697386', fontSize: 10 }}
                                  interval="preserveStartEnd"
                                  minTickGap={20}
                                  height={40}
                                />
                                <YAxis
                                  domain={['auto', 'auto']}
                                  stroke="#697386"
                                  tick={{ fill: '#697386', fontSize: 10 }}
                                  tickFormatter={(v) => `${v}${suffix}`}
                                  width={44}
                                />
                                <Tooltip
                                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e3e8ee', color: '#0a2540', borderRadius: 6 }}
                                  labelStyle={{ color: '#635bff', fontWeight: 600 }}
                                  formatter={(v) => [`${(+v).toFixed(2)}${suffix}`, isRateNative ? 'Level' : 'm/m']}
                                />
                                <ReferenceLine y={0} stroke="#cfd7df" />
                                <Bar dataKey={barKey} radius={[3, 3, 0, 0]}>
                                  {barData.map((d, i) => (
                                    <Cell key={i} fill={(isRateNative ? d.value : d.pct_change) >= 0 ? '#635bff' : '#b42318'} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                            )
                          })() : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#697386' }}>
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
                                    <th>Reference Month</th>
                                    <th title="Analyst consensus (ForexFactory) when available, else prior release">Forecast</th>
                                    <th>Actual</th>
                                    <th>Surprise</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const isRateNative = key === 'Unemployment Rate'
                                    const rows = chartData.slice().reverse()
                                    return rows.map((item, idx) => {
                                      const prevRow = rows[idx + 1]  // one period earlier (list is newest-first)
                                      const actual = isRateNative ? item.value : item.pct_change
                                      // Prefer FF consensus forecast on the row it applies to; otherwise fall back to prior release.
                                      let forecast, forecastFromFF = false
                                      if (typeof item.forecast === 'number') {
                                        forecast = item.forecast
                                        forecastFromFF = item.forecast_source === 'ff'
                                      } else if (isRateNative) {
                                        forecast = prevRow ? prevRow.value : null
                                      } else {
                                        forecast = prevRow ? prevRow.pct_change : null
                                      }
                                      const surprise = (typeof forecast === 'number' && typeof actual === 'number')
                                        ? actual - forecast
                                        : null
                                      const fmtPct = (v) => typeof v === 'number'
                                        ? `${v.toFixed(2)}%`
                                        : '—'
                                      return (
                                        <tr key={idx}>
                                          <td>{item.date}</td>
                                          <td>
                                            {fmtPct(forecast)}
                                            {forecastFromFF && (
                                              <span title="Analyst consensus from ForexFactory" style={{
                                                marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#635bff',
                                                background: 'rgba(99,91,255,0.1)', padding: '1px 5px', borderRadius: 4
                                              }}>FF</span>
                                            )}
                                          </td>
                                          <td><strong style={{color: '#0a2540'}}>{fmtPct(actual)}</strong></td>
                                          <td className={surprise === null ? '' : surprise >= 0 ? 'green' : 'red'}>
                                            {surprise === null ? '—' : `${surprise > 0 ? '+' : ''}${surprise.toFixed(2)} pp`}
                                          </td>
                                        </tr>
                                      )
                                    })
                                  })()}
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
        {fedwatchData && !fedwatchData.error && (() => {
          const meetings = (fedwatchData.meetings && fedwatchData.meetings.length > 0)
            ? fedwatchData.meetings
            : [{
                date: fedwatchData.next_meeting_date,
                target_rate_probabilities: fedwatchData.target_rate_probabilities || {},
                most_likely_change: fedwatchData.most_likely_change,
                most_likely_probability: fedwatchData.most_likely_probability,
                implied_rate: null,
              }]
          const idx = Math.min(selectedMeetingIdx, meetings.length - 1)
          const active = meetings[idx]
          return (
          <div className="fedwatch-card">
            <h3>FOMC Target-Rate Probabilities</h3>
            <div className="fedwatch-note">
              <span className="note-icon">▸</span>
              <span>
                {fedwatchData.source || 'CME Fed Funds futures'}
                {fedwatchData.current_target_rate && ` · Current target ${fedwatchData.current_target_rate} bps`}
                {fedwatchData.current_fed_rate !== undefined && fedwatchData.current_fed_rate !== null && ` · EFFR ${fedwatchData.current_fed_rate}%`}
              </span>
            </div>
            {fedwatchData.note && (
              <div className="fedwatch-note">
                <span className="note-icon">ℹ</span>
                <span>{fedwatchData.note}</span>
              </div>
            )}

            {meetings.length > 1 && (
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px'}}>
                {meetings.map((m, i) => (
                  <button
                    key={m.date_iso || m.date || i}
                    onClick={() => setSelectedMeetingIdx(i)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: '1px solid ' + (i === idx ? '#635bff' : '#e3e8ee'),
                      background: i === idx ? '#635bff' : '#ffffff',
                      color: i === idx ? '#ffffff' : '#425466',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                    }}
                  >
                    {m.date}
                  </button>
                ))}
              </div>
            )}

            <div className="fedwatch-content">
              <div className="fedwatch-meeting">
                <span className="fedwatch-label">Meeting</span>
                <span className="fedwatch-value">{active.date}</span>
              </div>
              {active.implied_rate !== null && active.implied_rate !== undefined && (
                <div className="fedwatch-meeting">
                  <span className="fedwatch-label">Implied Post-Meeting Rate</span>
                  <span className="fedwatch-value">{active.implied_rate.toFixed(3)}%</span>
                </div>
              )}

              {active.target_rate_probabilities && Object.keys(active.target_rate_probabilities).length > 0 && (
                <div className="fedwatch-chart-wrapper">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={Object.entries(active.target_rate_probabilities)
                        .sort((a, b) => parseInt(a[0].split('-')[0]) - parseInt(b[0].split('-')[0]))
                        .map(([range, prob]) => ({ range, probability: prob }))}
                      margin={{ top: 24, right: 30, left: 10, bottom: 60 }}
                      barCategoryGap="35%"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} />
                      <XAxis
                        dataKey="range"
                        stroke="#697386"
                        tick={{ fill: '#697386', fontSize: 12 }}
                        label={{ value: 'Target Rate (bps)', position: 'insideBottom', offset: -5, fill: '#697386' }}
                        angle={-30}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis
                        domain={[0, 100]}
                        stroke="#697386"
                        tick={{ fill: '#697386', fontSize: 12 }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e3e8ee', color: '#0a2540', borderRadius: 6 }}
                        labelStyle={{ color: '#635bff', fontWeight: 600 }}
                        formatter={(v) => [`${v}%`, 'Probability']}
                      />
                      <Bar
                        dataKey="probability"
                        fill="#635bff"
                        radius={[4, 4, 0, 0]}
                        label={{ position: 'top', fill: '#0a2540', fontSize: 12, fontWeight: 600, formatter: (v) => `${v}%` }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {active.most_likely_change && active.most_likely_probability !== undefined && (
                <div className="fedwatch-probability">
                  <span className="fedwatch-label">Most Likely Target Rate</span>
                  <span className="fedwatch-value highlight">
                    {active.most_likely_change} bps
                    <span className="probability-badge">{active.most_likely_probability}%</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          )
        })()}
        
        <div className="yield-curve-grid">
          {/* YIELD CURVE CHART */}
          <div className="card yield-curve-card">
            <h3>Yield Curve</h3>
            {ratesData && ratesData.yield_curve && ratesData.yield_curve.length > 0 ? (
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={ratesData.yield_curve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                    <XAxis 
                      dataKey="maturity" 
                      stroke="#697386"
                      tick={{ fill: '#697386', fontSize: 12 }}
                      label={{ value: 'Maturity', position: 'insideBottom', offset: -5, fill: '#697386' }}
                    />
                    <YAxis 
                      domain={[3, 'auto']}
                      stroke="#697386"
                      tick={{ fill: '#697386', fontSize: 12 }}
                      label={{ value: 'Yield (%)', angle: -90, position: 'insideLeft', fill: '#697386' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#ffffff', 
                        border: '1px solid #e3e8ee',
                        color: '#0a2540'
                      }}
                      labelStyle={{ color: '#635bff' }}
                      formatter={(value) => [`${value.toFixed(2)}%`, 'Yield']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="yield" 
                      stroke="#635bff" 
                      strokeWidth={3}
                      dot={{ r: 5, fill: '#635bff' }}
                      activeDot={{ r: 7, fill: '#067647' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#697386' }}>
                No yield data available
              </div>
            )}
          </div>
        </div>

        <div className="analysis-grid" style={{ gridTemplateColumns: 'auto 1fr', gap: '2rem' }}>
          {/* YIELD CURVE TABLE */}
          <div className="card" style={{ minWidth: '300px' }}>
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
          <div className="card" style={{ minWidth: 0 }}>
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
                  color: '#697386',
                  fontStyle: 'italic'
                }}>
                  Initializing interactive chart...
                </div>
              )
            ) : (
              <div style={{ 
                padding: '2rem', 
                textAlign: 'center', 
                color: '#697386',
                fontStyle: 'italic'
              }}>
                Loading yield curve data...
              </div>
            )}
          </div>

          {/* Header Separator */}
          <div style={{ 
            gridColumn: '1 / -1', 
            marginTop: '3rem', 
            marginBottom: '1.5rem',
            textAlign: 'center'
          }}>
            <h2 style={{ 
              color: '#635bff', 
              fontSize: '1.8rem', 
              fontWeight: '600',
              margin: 0,
              paddingBottom: '0.5rem',
              borderBottom: '2px solid #635bff',
              display: 'inline-block'
            }}>
              Trade Pitch
            </h2>
          </div>

          {/* BEAR STEEPENER TRADE PITCH */}
          <div className="card" style={{ gridColumn: '1 / -1', marginTop: '2rem' }}>
            <h3 style={{ color: '#635bff', marginBottom: '1.5rem' }}>Bear Steepener Trade: Short 10Y / Long 2Y</h3>
            
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
              // DV01 = duration * 0.0001 * notional (where 0.0001 = 1bp = 0.01%)
              // This gives dollars per 1 basis point
              const dv01_2Y = 1.9 * 0.0001 * 10_000_000; // 2Y duration ~1.9, gives $1,900 per 1bp
              const dv01_10Y = 8.3 * 0.0001 * 10_000_000; // 10Y duration ~8.3, gives $8,300 per 1bp
              
              // For duration-neutral trade, calculate position sizes
              // Short $10M 10Y, Long $X 2Y where X * dv01_2Y = 10M * dv01_10Y
              const long2YNotional = (10_000_000 * dv01_10Y) / dv01_2Y;
              
              // Calculate actual P&L based on current yield changes
              const yield2YChange = (yield2Y - original2Y) * 100; // in bps (e.g., 0.01 = 1.0 bps)
              const yield10YChange = (yield10Y - original10Y) * 100; // in bps
              
              // P&L calculation:
              // Short 10Y: When 10Y yield rises, bond price falls, short position makes money (positive P&L)
              // Long 2Y: When 2Y yield falls, bond price rises, long position makes money (positive P&L)
              // DV01 is in dollars per 1bp, yieldChange is in bps, so multiply directly (no division by 100)
              const dv01_2Y_scaled = dv01_2Y * long2YNotional / 10_000_000; // DV01 for the actual 2Y position size
              // DV01 is already $ per 1bp, yieldChange is in bps, so multiply directly (no /100 needed)
              const pnl_10Y_leg = yield10YChange * dv01_10Y; // yield10YChange (bps) * dv01_10Y ($/bp) = $ P&L
              const pnl_2Y_leg = -yield2YChange * dv01_2Y_scaled; // yield2YChange (bps) * dv01_2Y_scaled ($/bp) = $ P&L
              const totalPnl = pnl_10Y_leg + pnl_2Y_leg;
              
              // Calculate total DV01 (for spread widening - when 10Y rises 1bp and 2Y unchanged)
              // This is the DV01 of the trade for a 1bp spread widening
              // Note: DV01 values are in dollars per 1bp, so totalDv01/100 gives dollars per 1bp for display
              const totalDv01 = dv01_10Y + dv01_2Y_scaled; // Should be ~$8,300
              
              // P&L scenarios (for display)
              const pnl_10Y_up_1bp = dv01_10Y; // Short gains when yield rises
              const pnl_2Y_down_1bp = dv01_2Y * (long2YNotional / 10_000_000); // Long gains when yield falls
              const pnl_spread_widen_10bps = 10 * (dv01_10Y + (dv01_2Y * long2YNotional / 10_000_000));
              
              // Build full yield curve data with 2Y and 10Y highlighted
              const fullCurveData = ratesData.yield_curve
                .map(item => {
                  const maturity = item.maturity;
                  let yieldValue = item.yield;
                  let isHighlighted = false;
                  
                  // Use interactive yields for 2Y and 10Y if set
                  if (maturity === '2Y' && tradeYields['2Y'] !== null) {
                    yieldValue = tradeYields['2Y'];
                    isHighlighted = true;
                  } else if (maturity === '10Y' && tradeYields['10Y'] !== null) {
                    yieldValue = tradeYields['10Y'];
                    isHighlighted = true;
                  } else if (maturity === '2Y' || maturity === '10Y') {
                    isHighlighted = true;
                  }
                  
                  return {
                    maturity,
                    yield: yieldValue,
                    originalYield: item.yield,
                    isHighlighted,
                    color: maturity === '2Y' ? '#067647' : maturity === '10Y' ? '#f87171' : '#635bff'
                  };
                })
                .sort((a, b) => maturityToYears(a.maturity) - maturityToYears(b.maturity));
              
              const chartData = fullCurveData;
              
              return (
                <div>
                  {/* Interactive Chart */}
                  <div style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ color: '#697386', fontSize: '0.9rem', fontWeight: '500' }}>2Y Yield:</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="20"
                            value={yield2Y > 0 ? yield2Y.toFixed(2) : ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0) {
                                setTradeYields(prev => ({ ...prev, '2Y': val }));
                              } else if (e.target.value === '' || e.target.value === '.') {
                                // Allow empty input while typing
                                setTradeYields(prev => ({ ...prev, '2Y': null }));
                              }
                            }}
                            placeholder={original2Y > 0 ? original2Y.toFixed(2) : '0.00'}
                            style={{
                              width: '100px',
                              padding: '0.5rem 0.75rem',
                              background: '#e3e8ee',
                              border: '2px solid #067647',
                              borderRadius: '6px',
                              color: '#0a2540',
                              fontSize: '1rem',
                              fontWeight: '500',
                              cursor: 'text',
                              outline: 'none',
                              transition: 'all 0.2s'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = '#067647';
                              e.target.style.boxShadow = '0 0 0 3px rgba(6, 118, 71, 0.2)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = '#067647';
                              e.target.style.boxShadow = 'none';
                              // Ensure valid value on blur
                              const val = parseFloat(e.target.value);
                              if (isNaN(val) || val < 0) {
                                setTradeYields(prev => ({ ...prev, '2Y': original2Y }));
                              }
                            }}
                          />
                          <span style={{ color: '#697386', fontSize: '0.9rem', fontWeight: '500' }}>%</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ color: '#697386', fontSize: '0.9rem', fontWeight: '500' }}>10Y Yield:</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="20"
                            value={yield10Y > 0 ? yield10Y.toFixed(2) : ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0) {
                                setTradeYields(prev => ({ ...prev, '10Y': val }));
                              } else if (e.target.value === '' || e.target.value === '.') {
                                // Allow empty input while typing
                                setTradeYields(prev => ({ ...prev, '10Y': null }));
                              }
                            }}
                            placeholder={original10Y > 0 ? original10Y.toFixed(2) : '0.00'}
                            style={{
                              width: '100px',
                              padding: '0.5rem 0.75rem',
                              background: '#e3e8ee',
                              border: '2px solid #f87171',
                              borderRadius: '6px',
                              color: '#0a2540',
                              fontSize: '1rem',
                              fontWeight: '500',
                              cursor: 'text',
                              outline: 'none',
                              transition: 'all 0.2s'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = '#f87171';
                              e.target.style.boxShadow = '0 0 0 3px rgba(180, 35, 24, 0.2)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = '#f87171';
                              e.target.style.boxShadow = 'none';
                              // Ensure valid value on blur
                              const val = parseFloat(e.target.value);
                              if (isNaN(val) || val < 0) {
                                setTradeYields(prev => ({ ...prev, '10Y': original10Y }));
                              }
                            }}
                          />
                          <span style={{ color: '#697386', fontSize: '0.9rem', fontWeight: '500' }}>%</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setTradeYields({ '2Y': null, '10Y': null })}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#e3e8ee',
                          border: '1px solid #635bff',
                          borderRadius: '4px',
                          color: '#635bff',
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
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                        <XAxis 
                          dataKey="maturity" 
                          stroke="#697386"
                          tick={{ fill: '#697386', fontSize: 11 }}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          stroke="#697386"
                          tick={{ fill: '#697386', fontSize: 12 }}
                          label={{ value: 'Yield (%)', angle: -90, position: 'insideLeft', fill: '#697386' }}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#ffffff', 
                            border: '1px solid #e3e8ee',
                            color: '#0a2540'
                          }}
                          formatter={(value, name, props) => {
                            const maturity = props.payload.maturity;
                            const original = props.payload.originalYield;
                            const change = ((value - original) * 100).toFixed(1);
                            const changeText = Math.abs(value - original) > 0.001 
                              ? ` (${change > 0 ? '+' : ''}${change} bps)`
                              : '';
                            return [
                              `${value.toFixed(2)}%${changeText}`,
                              'Yield'
                            ];
                          }}
                        />
                        {/* Full yield curve line - all points */}
                        <Line 
                          type="monotone" 
                          dataKey="yield" 
                          stroke="#635bff" 
                          strokeWidth={2}
                          strokeOpacity={0.3}
                          dot={(props) => {
                            const { cx, cy, payload } = props;
                            // Only show dots for highlighted points (2Y and 10Y)
                            if (payload.isHighlighted) {
                              const isChanged = Math.abs(payload.yield - payload.originalYield) > 0.001;
                              return (
                                <g>
                                  <circle 
                                    cx={cx} 
                                    cy={cy} 
                                    r={isChanged ? 12 : 10} 
                                    fill={payload.color}
                                    stroke={isChanged ? '#067647' : '#fff'}
                                    strokeWidth={isChanged ? 3 : 2}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Allow dragging by clicking and moving
                                    }}
                                  />
                                  {isChanged && (
                                    <circle 
                                      cx={cx} 
                                      cy={cy} 
                                      r={14} 
                                      fill="none"
                                      stroke="#067647"
                                      strokeWidth={2}
                                      strokeDasharray="4 4"
                                      opacity={0.6}
                                    />
                                  )}
                                </g>
                              );
                            }
                            return null;
                          }}
                          activeDot={(props) => {
                            const { cx, cy, payload } = props;
                            if (payload.isHighlighted) {
                              return (
                                <circle 
                                  cx={cx} 
                                  cy={cy} 
                                  r={14} 
                                  fill={payload.color}
                                  stroke="#fff"
                                  strokeWidth={3}
                                />
                              );
                            }
                            return null;
                          }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-around', 
                      marginTop: '1rem',
                      padding: '1rem',
                      background: 'rgba(99, 91, 255, 0.05)',
                      borderRadius: '6px',
                      flexWrap: 'wrap',
                      gap: '1rem'
                    }}>
                      <div style={{ textAlign: 'center', minWidth: '120px' }}>
                        <div style={{ color: '#697386', fontSize: '0.85rem', marginBottom: '0.25rem' }}>2Y Yield</div>
                        <div style={{ color: '#067647', fontSize: '1.1rem', fontWeight: 'bold' }}>
                          {yield2Y > 0 ? yield2Y.toFixed(2) + '%' : 'N/A'}
                          {yield2Y > 0 && Math.abs(yield2Y - original2Y) > 0.001 && (
                            <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem', display: 'block', marginTop: '0.25rem' }}>
                              ({((yield2Y - original2Y) * 100) > 0 ? '+' : ''}{((yield2Y - original2Y) * 100).toFixed(1)} bps)
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', minWidth: '120px' }}>
                        <div style={{ color: '#697386', fontSize: '0.85rem', marginBottom: '0.25rem' }}>10Y Yield</div>
                        <div style={{ color: '#f87171', fontSize: '1.1rem', fontWeight: 'bold' }}>
                          {yield10Y > 0 ? yield10Y.toFixed(2) + '%' : 'N/A'}
                          {yield10Y > 0 && Math.abs(yield10Y - original10Y) > 0.001 && (
                            <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem', display: 'block', marginTop: '0.25rem' }}>
                              ({((yield10Y - original10Y) * 100) > 0 ? '+' : ''}{((yield10Y - original10Y) * 100).toFixed(1)} bps)
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', minWidth: '140px' }}>
                        <div style={{ color: '#697386', fontSize: '0.85rem', marginBottom: '0.25rem' }}>2s10s Spread</div>
                        <div style={{ color: '#635bff', fontSize: '1.1rem', fontWeight: 'bold' }}>
                          {yield2Y > 0 && yield10Y > 0 ? (spread * 100).toFixed(2) + ' bps' : 'N/A'}
                          {yield2Y > 0 && yield10Y > 0 && Math.abs(spreadChange) > 0.1 && (
                            <span style={{ 
                              fontSize: '0.9rem', 
                              marginLeft: '0.5rem',
                              display: 'block',
                              marginTop: '0.25rem',
                              color: spreadChange > 0 ? '#067647' : '#f87171'
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
                      background: 'rgba(6, 118, 71, 0.1)', 
                      border: '1px solid rgba(6, 118, 71, 0.3)',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#697386', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Long Position</div>
                      <div style={{ color: '#067647', fontSize: '1.2rem', fontWeight: 'bold' }}>2Y Treasury</div>
                      <div style={{ color: '#0a2540', marginTop: '0.5rem' }}>Notional: ${(long2YNotional / 1_000_000).toFixed(2)}M</div>
                      <div style={{ color: '#697386', fontSize: '0.9rem', marginTop: '0.25rem' }}>DV01: ${(dv01_2Y * long2YNotional / 10_000_000).toLocaleString()}</div>
                    </div>
                    
                    <div style={{ 
                      padding: '1rem', 
                      background: 'rgba(180, 35, 24, 0.1)', 
                      border: '1px solid rgba(180, 35, 24, 0.3)',
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#697386', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Short Position</div>
                      <div style={{ color: '#f87171', fontSize: '1.2rem', fontWeight: 'bold' }}>10Y Treasury</div>
                      <div style={{ color: '#0a2540', marginTop: '0.5rem' }}>Notional: $10.00M</div>
                      <div style={{ color: '#697386', fontSize: '0.9rem', marginTop: '0.25rem' }}>DV01: ${dv01_10Y.toLocaleString()}</div>
                    </div>
                    
                    <div style={{ 
                      padding: '1rem', 
                      background: Math.abs(totalPnl) > 0.01 ? (totalPnl > 0 ? 'rgba(6, 118, 71, 0.1)' : 'rgba(180, 35, 24, 0.1)') : 'rgba(99, 91, 255, 0.1)', 
                      border: `1px solid ${Math.abs(totalPnl) > 0.01 ? (totalPnl > 0 ? 'rgba(6, 118, 71, 0.3)' : 'rgba(180, 35, 24, 0.3)') : 'rgba(99, 91, 255, 0.3)'}`,
                      borderRadius: '6px'
                    }}>
                      <div style={{ color: '#697386', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                        {Math.abs(totalPnl) > 0.01 ? 'Current P&L' : 'P&L Scenarios'}
                      </div>
                      {Math.abs(totalPnl) > 0.01 ? (
                        <div style={{ 
                          color: totalPnl > 0 ? '#067647' : '#f87171', 
                          fontSize: '1.3rem', 
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}>
                          {totalPnl > 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      ) : (
                        <div style={{ color: '#0a2540', fontSize: '0.9rem', lineHeight: '1.6' }}>
                          <div>10Y ↑1bp, 2Y flat: <span style={{ color: '#067647' }}>+${dv01_10Y.toLocaleString()}</span></div>
                          <div>2Y ↓1bp, 10Y flat: <span style={{ color: '#067647' }}>+${dv01_2Y_scaled.toLocaleString()}</span></div>
                          <div>Spread widens 10bps: <span style={{ color: '#067647' }}>+${(totalDv01 * 10).toLocaleString()}</span></div>
                          <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(139, 149, 178, 0.2)' }}>
                            <div style={{ color: '#697386', fontSize: '0.8rem' }}>Trade DV01: ${totalDv01.toLocaleString()}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Trade Explanation */}
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ color: '#635bff', marginBottom: '1rem' }}>The Trade</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(99, 91, 255, 0.05)', 
                      border: '1px solid rgba(99, 91, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#0a2540',
                      lineHeight: '1.8'
                    }}>
                      <p style={{ marginBottom: '1rem' }}>
                        <strong style={{ color: '#635bff' }}>Action:</strong> Short the 10-year Treasury Note (sell futures) and Long the 2-year Treasury Note (buy futures).
                      </p>
                      <p style={{ marginBottom: '1rem' }}>
                        <strong style={{ color: '#635bff' }}>Target:</strong> Current 2s10s spread is {(spread * 100).toFixed(0)} bps. Target a widening to +100 bps as the "term premium" returns to historical norms.
                      </p>
                      <p>
                        <strong style={{ color: '#635bff' }}>Duration Neutrality:</strong> Position is weighted by DV01 to ensure this is a "curve play" and not just a bet on direction. The trade profits from curve steepening regardless of parallel rate moves.
                      </p>
                    </div>
                  </div>

                  {/* Why This Trade */}
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ color: '#635bff', marginBottom: '1rem' }}>Why This Trade: The "Hawkish Easing" Cycle</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(99, 91, 255, 0.05)', 
                      border: '1px solid rgba(99, 91, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#0a2540',
                      lineHeight: '1.8'
                    }}>
                      <p style={{ marginBottom: '1rem' }}>
                        Based on market data from late December 2025, we are witnessing a unique "Hawkish Easing" cycle. The Federal Reserve recently delivered a 25bps cut (bringing the target to 3.50%–3.75%), but coupled it with a "dot plot" that signaled only one more cut for all of 2026.
                      </p>
                      <p style={{ marginBottom: '1rem' }}>
                        This has resulted in a <strong style={{ color: '#635bff' }}>Bear Steepening</strong> of the yield curve. While short-term rates are drifting lower due to the actual cuts, long-term yields (10Y and 30Y) are rising as investors demand a higher "term premium" to compensate for persistent inflation risks (Core PCE at 2.8%) and massive Treasury supply.
                      </p>
                      
                      <div style={{ marginTop: '1.5rem' }}>
                        <h5 style={{ color: '#635bff', marginBottom: '0.75rem' }}>The Thesis</h5>
                        <div style={{ marginLeft: '1rem' }}>
                          <p style={{ marginBottom: '0.75rem' }}>
                            <strong style={{ color: '#067647' }}>The Front End is Anchored:</strong> The Fed has entered a "wait and see" mode. Even if they don't cut aggressively, the 2-year yield is unlikely to spike because the hiking cycle is definitively over.
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
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ color: '#f87171', marginBottom: '1rem' }}>Risk Factors</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(180, 35, 24, 0.05)', 
                      border: '1px solid rgba(180, 35, 24, 0.2)',
                      borderRadius: '6px',
                      color: '#0a2540',
                      lineHeight: '1.8'
                    }}>
                      <p>
                        <strong style={{ color: '#f87171' }}>The "Bull Flattener" Risk:</strong> If a sudden recessionary shock occurs (e.g., unemployment spikes toward 5%), the Fed would likely slash rates aggressively. In that scenario, the 2-year would crash much faster than the 10-year, causing the curve to "Bull Steepen" instead. While you still profit from the widening spread, the "Short 10Y" leg would lose money on a nominal basis.
                      </p>
                    </div>
                  </div>

                  {/* Cost of Carry */}
                  <div>
                    <h4 style={{ color: '#fbbf24', marginBottom: '1rem' }}>Cost of Carry & Roll-Down</h4>
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(251, 191, 36, 0.05)', 
                      border: '1px solid rgba(251, 191, 36, 0.2)',
                      borderRadius: '6px',
                      color: '#0a2540',
                      lineHeight: '1.8'
                    }}>
                      <p style={{ marginBottom: '1rem' }}>
                        <strong style={{ color: '#fbbf24' }}>The "Rent" to Stay in the Position:</strong> This trade has a negative carry and roll-down, meaning it costs money to hold the position if the curve stays static.
                      </p>
                      
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h5 style={{ color: '#fbbf24', marginBottom: '0.75rem', fontSize: '1rem' }}>1. Carry Calculation (Cash Flow)</h5>
                        <div style={{ marginLeft: '1rem', fontSize: '0.9rem' }}>
                          <p style={{ marginBottom: '0.5rem' }}>
                            <strong>Long 2Y Side:</strong> Earn yield ({yield2Y > 0 ? yield2Y.toFixed(2) : 'N/A'}%) but pay repo financing (~{yield2Y > 0 ? (yield2Y + 0.15).toFixed(2) : 'N/A'}%). 
                            <span style={{ color: '#f87171' }}> Net Carry: ~-0.15% (Negative)</span>
                          </p>
                          <p style={{ marginBottom: '0.5rem' }}>
                            <strong>Short 10Y Side:</strong> Pay coupon ({yield10Y > 0 ? yield10Y.toFixed(2) : 'N/A'}%) but earn rebate on cash collateral. 
                            <span style={{ color: '#f87171' }}> Net Carry: Typically negative for on-the-run bonds</span>
                          </p>
                          <p style={{ marginTop: '0.75rem', color: '#697386', fontStyle: 'italic' }}>
                            Total Monthly Carry Cost: ~${((Math.abs(yield2Y - (yield2Y + 0.15)) / 100) * long2YNotional / 12 + (yield10Y / 100) * 10_000_000 / 12).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>

                      <div style={{ marginBottom: '1.5rem' }}>
                        <h5 style={{ color: '#fbbf24', marginBottom: '0.75rem', fontSize: '1rem' }}>2. Roll-Down (Price Appreciation)</h5>
                        <div style={{ marginLeft: '1rem', fontSize: '0.9rem' }}>
                          <p style={{ marginBottom: '0.5rem' }}>
                            As bonds approach maturity, they "roll down" the yield curve. In an upward-sloping curve, this means prices naturally rise.
                          </p>
                          <p style={{ marginBottom: '0.5rem' }}>
                            <strong>Critical Point:</strong> Since you are <strong style={{ color: '#f87171' }}>SHORT</strong> the 10Y, roll-down works <strong style={{ color: '#f87171' }}>AGAINST</strong> you. As the 10Y bond's price rises from rolling down, your short position loses money.
                          </p>
                          <p style={{ marginTop: '0.75rem', color: '#697386', fontStyle: 'italic' }}>
                            Estimated Monthly Roll-Down Cost: ~${((0.10 * dv01_10Y / 12)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>

                      <div style={{ 
                        marginTop: '1.5rem', 
                        padding: '1rem', 
                        background: 'rgba(251, 191, 36, 0.1)', 
                        border: '1px solid rgba(251, 191, 36, 0.3)',
                        borderRadius: '4px'
                      }}>
                        <p style={{ marginBottom: '0.75rem' }}>
                          <strong style={{ color: '#fbbf24' }}>Total Monthly Cost (Carry + Roll):</strong> 
                          <span style={{ color: '#f87171', fontSize: '1.1rem', marginLeft: '0.5rem' }}>
                            ~${yield2Y > 0 && yield10Y > 0 ? ((((0.15 / 100) * long2YNotional / 12) + ((0.10 / 100) * 10_000_000 / 12) + (0.10 * dv01_10Y / 12)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : 'N/A'}
                          </span>
                        </p>
                        <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                          <strong style={{ color: '#635bff' }}>Breakeven Analysis:</strong> The trade has a negative carry and roll of approximately <strong>-1.2 basis points per month</strong>. This means if the yield curve stays static, the position loses about <strong>${yield2Y > 0 && yield10Y > 0 ? ((((0.15 / 100) * long2YNotional / 12) + ((0.10 / 100) * 10_000_000 / 12) + (0.10 * dv01_10Y / 12)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })) : 'N/A'}</strong> per month in "theta" decay.
                        </p>
                        <p style={{ fontSize: '0.9rem', color: '#067647' }}>
                          <strong>Conviction:</strong> However, fiscal supply pressure is expected to steepen the 2s10s spread by 25-30 bps over the next quarter, offering a risk-reward ratio of roughly <strong>8-to-1</strong> against the carry cost.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#697386' }}>
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