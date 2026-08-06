import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const THEME_KEY = 'metromecanica_theme'

// ─── SONIDO DE SELECCIÓN — sintetizado con Web Audio API, sin archivos externos ──
// Un "beep" corto de confirmación, como el de un instrumento calibrado al aceptar
// una lectura — no una notificación genérica de celular.
function playSelectSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.06)
    gain.gain.setValueAtTime(0.09, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.15)
  } catch (e) { /* audio no disponible, no romper la navegación por esto */ }
}

// ─── FONDO DE ONDAS (modo claro) — patrón tipo "chirp" (barrido de frecuencia) ──
// Recreado en código, no como imagen: un chirp es una señal real usada en pruebas
// de calibración, así que encaja con el negocio, no es solo decorativo.
function chirpPath(width, height, offsetY, ampMul, seedPhase) {
  const points = 220
  let d = ''
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const x = t * width
    const amp = ampMul * height * (0.12 + 0.4 * Math.pow(Math.sin(t * Math.PI * 1.15), 2) + 0.55 * Math.pow(t, 2.2))
    const freq = 3.5 + t * 46
    const y = offsetY + amp * Math.sin(t * freq + seedPhase)
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' '
  }
  return d
}

function WaveBackground() {
  const width = 1400, height = 420
  const lines = useMemo(() => {
    const arr = []
    for (let i = 0; i < 13; i++) {
      arr.push({
        d: chirpPath(width, height, height * 0.55 + (i - 6) * 9, 0.9, i * 0.35),
        opacity: 0.06 + (i % 3) * 0.02,
      })
    }
    return arr
  }, [])
  return (
    <svg className="wave-bg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {lines.map((l, i) => (
        <path key={i} d={l.d} fill="none" stroke="currentColor" strokeWidth="1.2" opacity={l.opacity} />
      ))}
    </svg>
  )
}

// ─── LOGO — recreado en SVG (círculo + barras), sin depender de hosting de imagen ──
function LogoMark({ size = 44 }) {
  const bars = [10, 22, 32, 40, 32, 22, 10]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill="#c81e3a" />
      <g clipPath="url(#clip)">
        <clipPath id="clip"><circle cx="50" cy="50" r="48" /></clipPath>
        {bars.map((h, i) => (
          <rect key={i} x={16 + i * 10} y={50 - h / 2} width="6" height={h} fill="#fff" opacity="0.95" />
        ))}
      </g>
    </svg>
  )
}

// ─── GAUGE — instrumento circular con aguja y glow latente ──────────────────
function Gauge({ label, value, max, color, unit = '' }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const angle = -120 + pct * 240 // arco de 240°, de -120° a +120°
  const R = 42
  const circumference = 2 * Math.PI * R * (240 / 360)
  const dash = circumference * pct

  return (
    <div className="gauge">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#182430" strokeWidth="8" strokeDasharray={`${circumference} 999`} strokeDashoffset={0} transform="rotate(150 60 60)" strokeLinecap="round" />
        <circle
          cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} 999`} transform="rotate(150 60 60)" strokeLinecap="round"
          className="gauge-arc" style={{ filter: `drop-shadow(0 0 6px ${color}90)` }}
        />
        <g transform={`rotate(${angle} 60 60)`} className="gauge-needle">
          <line x1="60" y1="60" x2="60" y2="26" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="60" r="4" fill={color} />
        </g>
      </svg>
      <div className="gauge-value" style={{ color }}>{value}{unit}</div>
      <div className="gauge-label">{label}</div>
    </div>
  )
}

const CSS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800&family=DM+Mono:wght@400;500&family=Rajdhani:wght@500;600;700&display=swap');

    .portal-wrap {
      --bg: #060a10; --bg2: #0b121a; --bg3: #101a24;
      --border: #1a2836; --text: #e6edf3; --text-dim: #6d8598;
      --red: #ff3b4e; --teal: #00e5b8; --gold: #f0a500;
      background: var(--bg); color: var(--text);
      min-height: 100vh; font-family: 'Rajdhani', sans-serif;
      position: relative; overflow-x: hidden;
      transition: background .25s, color .25s;
    }
    .portal-wrap[data-theme='light'] {
      --bg: #f6f8fa; --bg2: #ffffff; --bg3: #eef2f5;
      --border: #dde4e9; --text: #17222c; --text-dim: #5c6d7a;
      --red: #d81e3a; --teal: #00997a; --gold: #b9790a;
    }
    .wave-bg {
      position: fixed; top: 0; left: 0; width: 100%; height: 340px;
      color: #17222c; pointer-events: none; z-index: 0; opacity: 0;
      transition: opacity .3s;
    }
    .portal-wrap[data-theme='light'] .wave-bg { opacity: 1; }
    .portal-wrap[data-theme='light'] .portal-grid-bg,
    .portal-wrap[data-theme='light'] .portal-glow { opacity: 0; }
    .portal-grid-bg {
      position: fixed; inset: 0; pointer-events: none; z-index: 0;
      background-image:
        linear-gradient(rgba(0,229,184,.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,229,184,.025) 1px, transparent 1px);
      background-size: 64px 64px;
    }
    .portal-glow {
      position: fixed; top: -200px; left: 50%; transform: translateX(-50%);
      width: 900px; height: 500px; pointer-events: none; z-index: 0;
      background: radial-gradient(ellipse, rgba(255,59,78,.05) 0%, rgba(0,229,184,.04) 45%, transparent 70%);
    }

    .portal-inner { position: relative; z-index: 1; padding: 28px 32px 60px; max-width: 1280px; margin: 0 auto; }

    .portal-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 28px; flex-wrap: wrap; gap: 16px;
    }
    .portal-brand { display: flex; align-items: center; gap: 14px; }
    .portal-brand h1 {
      font-family: 'Orbitron', sans-serif; font-size: 20px; font-weight: 700;
      letter-spacing: 2px; margin: 0; color: var(--text);
    }
    .portal-brand h1 span { color: var(--teal); }
    .portal-brand .sub {
      font-family: 'DM Mono', monospace; font-size: 10px; color: var(--text-dim);
      letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px;
    }
    .portal-area-badge {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 4px;
      font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 1px;
      color: var(--teal); text-transform: uppercase;
    }
    .portal-area-dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--teal);
      box-shadow: 0 0 6px var(--teal); animation: pulse-dot 2s ease-in-out infinite;
    }
    @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

    .portal-actions { display: flex; gap: 8px; }
    .portal-btn {
      font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500;
      letter-spacing: .5px; padding: 9px 16px; border-radius: 8px; cursor: pointer;
      background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
      transition: all .15s;
    }
    .portal-btn:hover { border-color: var(--teal); color: var(--teal); }
    .portal-btn.danger:hover { border-color: var(--red); color: var(--red); }

    /* ── Consola de instrumentos ── */
    .console {
      background: linear-gradient(180deg, var(--bg2), var(--bg3));
      border: 1px solid var(--border); border-radius: 16px;
      padding: 20px 28px; margin-bottom: 32px;
      display: flex; align-items: center; justify-content: space-around;
      flex-wrap: wrap; gap: 20px; position: relative; overflow: hidden;
    }
    .console::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--red), var(--teal), var(--gold), transparent);
      opacity: .6;
    }
    .console-label {
      font-family: 'DM Mono', monospace; font-size: 9px; color: var(--text-dim);
      letter-spacing: 2px; text-transform: uppercase; position: absolute; top: 10px; left: 20px;
    }

    .gauge { display: flex; flex-direction: column; align-items: center; padding-top: 14px; }
    .gauge-arc { transition: stroke-dasharray 1s ease-out; }
    .gauge-needle {
      transform-origin: 60px 60px; transition: transform 1.2s cubic-bezier(.34,1.56,.64,1);
      filter: drop-shadow(0 0 4px currentColor);
    }
    .gauge-value {
      font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 800;
      margin-top: -6px; line-height: 1;
    }
    .gauge-label {
      font-family: 'DM Mono', monospace; font-size: 9px; color: var(--text-dim);
      letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; text-align: center;
    }

    /* ── Grid de herramientas ── */
    .tools-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 14px;
    }
    .tool-card {
      background: var(--bg2); border: 1px solid var(--border); border-radius: 12px;
      padding: 22px 16px; text-align: center; cursor: pointer; position: relative;
      transition: transform .15s, border-color .15s, box-shadow .15s; overflow: hidden;
    }
    .tool-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: var(--teal); opacity: 0; transition: opacity .2s;
    }
    .tool-card:hover {
      transform: translateY(-3px); border-color: rgba(0,229,184,.4);
      box-shadow: 0 8px 24px rgba(0,229,184,.12);
    }
    .tool-card:hover::before { opacity: 1; }
    .tool-icon { font-size: 30px; margin-bottom: 10px; filter: drop-shadow(0 0 8px rgba(0,229,184,.15)); }
    .tool-name { font-size: 13px; font-weight: 600; letter-spacing: .3px; }
    .portal-wrap[data-theme='light'] .tool-card {
      box-shadow: 0 1px 3px rgba(20,30,40,.06);
    }
    .portal-wrap[data-theme='light'] .tool-card:hover {
      box-shadow: 0 8px 20px rgba(0,153,122,.12);
    }

    .theme-toggle {
      width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg3); color: var(--text-dim); cursor: pointer;
      display: flex; align-items: center; justify-content: center; font-size: 15px;
      transition: all .15s;
    }
    .theme-toggle:hover { border-color: var(--teal); color: var(--teal); }

    @media (prefers-reduced-motion: reduce) {
      .portal-area-dot, .gauge-needle, .gauge-arc { animation: none !important; transition: none !important; }
    }
    @media (max-width: 640px) {
      .portal-inner { padding: 20px 16px 40px; }
      .console { padding: 30px 16px 16px; }
    }
  `}</style>
)

export default function Portal({ profile, onLogout }) {
  const [herramientas, setHerramientas] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ otsActivas: 0, docsHoy: 0, otsConcluidasMes: 0 })
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return window.localStorage.getItem(THEME_KEY) || 'dark'
  })
  const navigate = useNavigate()
  const esGerencia = profile?.area === 'gerencia'

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    window.localStorage.setItem(THEME_KEY, next)
  }

  useEffect(() => {
    async function cargar() {
      const { data, error } = await supabase.from('herramientas').select('*').order('orden', { ascending: true })
      if (!error) setHerramientas(data || [])
      setLoading(false)
    }
    cargar()
  }, [])

  useEffect(() => {
    async function cargarStats() {
      const hoyISO = new Date().toISOString().split('T')[0]
      const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
      const [otsActivas, docsHoy, otsConcluidasMes] = await Promise.all([
        supabase.from('services').select('*', { count: 'exact', head: true }).neq('status', 'concluido'),
        supabase.from('documentos').select('*', { count: 'exact', head: true }).gte('created_at', hoyISO),
        supabase.from('services').select('*', { count: 'exact', head: true }).eq('status', 'concluido').gte('updated_at', inicioMes.toISOString()),
      ])
      setStats({
        otsActivas: otsActivas.count ?? 0,
        docsHoy: docsHoy.count ?? 0,
        otsConcluidasMes: otsConcluidasMes.count ?? 0,
      })
    }
    cargarStats()
    const t = setInterval(cargarStats, 60000)
    return () => clearInterval(t)
  }, [])

  function abrir(url) {
    playSelectSound()
    if (url.startsWith('/')) navigate(url)
    else window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="portal-wrap" data-theme={theme}>
      <CSS />
      <WaveBackground />
      <div className="portal-grid-bg" />
      <div className="portal-glow" />
      <div className="portal-inner">

        <div className="portal-header">
          <div className="portal-brand">
            <LogoMark />
            <div>
              <h1>METRO<span>MECANICA</span></h1>
              <div className="sub">Central de Trabajo · Documentos & Calibración</div>
              <div className="portal-area-badge">
                <span className="portal-area-dot" />
                Área: {profile?.area || '—'}
              </div>
            </div>
          </div>
          <div className="portal-actions">
            <button className="theme-toggle" onClick={toggleTheme} title="Cambiar tema">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            {esGerencia && (
              <button className="portal-btn" onClick={() => navigate('/admin/herramientas')}>
                Administrar herramientas
              </button>
            )}
            <button className="portal-btn danger" onClick={onLogout}>Salir</button>
          </div>
        </div>

        <div className="console">
          <div className="console-label">Panel de control · en vivo</div>
          <Gauge label="OTs activas" value={stats.otsActivas} max={Math.max(stats.otsActivas * 1.4, 10)} color="#ff3b4e" />
          <Gauge label="Docs. subidos hoy" value={stats.docsHoy} max={Math.max(stats.docsHoy * 1.4, 15)} color="#00e5b8" />
          <Gauge label="OTs concluidas (mes)" value={stats.otsConcluidasMes} max={Math.max(stats.otsConcluidasMes * 1.4, 10)} color="#f0a500" />
        </div>

        {loading && <p style={{ color: 'var(--text-dim)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>Cargando herramientas...</p>}

        {!loading && (
          <div className="tools-grid">
            {herramientas.map((h) => (
              <div key={h.id} className="tool-card" onClick={() => abrir(h.url)}>
                <div className="tool-icon">{h.icono}</div>
                <div className="tool-name">{h.nombre}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
