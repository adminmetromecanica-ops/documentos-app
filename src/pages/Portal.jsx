import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const THEME_KEY = 'metromecanica_theme'
const LOGO_URL = 'https://ndcjjksaiecsuzperrhp.supabase.co/storage/v1/object/public/ot-files/logo.png'

// ── Áreas con acceso a la herramienta de Seguimiento de Facturas ──────────
// 'contabilidad' edita (marcar cobrado); 'gerencia' (que también es el área
// de la cuenta admin@) accede en modo solo lectura. Ver SeguimientoFacturas.jsx.
const AREAS_VEN_FACTURAS = ['contabilidad', 'gerencia']

// ─── SONIDO DE SELECCIÓN — un solo AudioContext reutilizado, activado con .resume() ──
let _audioCtx = null
function getAudioCtx() {
  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    _audioCtx = new Ctx()
  }
  return _audioCtx
}
function playSelectSound() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.06)
    gain.gain.setValueAtTime(0.16, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.17)
  } catch (e) { /* audio no disponible, no romper la navegación por esto */ }
}

// ─── SONIDO DE HOVER — "tick" corto y discreto, distinto al de selección ──────
function playHoverSound() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1450, ctx.currentTime)
    gain.gain.setValueAtTime(0.05, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.06)
  } catch (e) { /* audio no disponible, no interrumpir la interacción por esto */ }
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

// ─── LOGO — imagen real subida a Supabase Storage (bucket ot-files) ──────────
function LogoMark({ size = 44 }) {
  return <img src={LOGO_URL} alt="MetroMecánica" style={{ width: size, height: size, objectFit: 'contain' }} />
}

// ─── RELOJ Y FECHA EN VIVO ────────────────────────────────────────────────────
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const pad = (n) => String(n).padStart(2, '0')
  const hora = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const fecha = `${DIAS[now.getDay()]} ${now.getDate()} ${MESES[now.getMonth()]} ${now.getFullYear()}`
  return (
    <div className="live-clock">
      <div className="live-clock-time">{hora}</div>
      <div className="live-clock-date">{fecha}</div>
    </div>
  )
}

// ─── GAUGE — anillo delgado con glow, gradiente y mini-tendencia (estilo Grafana "New!") ──
function Gauge({ label, value, max, color, history = [] }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const R = 46
  const circumference = 2 * Math.PI * R * (270 / 360)
  const dash = circumference * pct
  const gid = `grad-${label.replace(/\s/g, '')}`

  // mini-tendencia (sparkline) con las últimas lecturas acumuladas en esta sesión
  const spark = useMemo(() => {
    if (history.length < 2) return ''
    const w = 70, h = 20
    const vals = history.slice(-16)
    const max2 = Math.max(...vals, 1)
    const min2 = Math.min(...vals, 0)
    const range = max2 - min2 || 1
    return vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w
      const y = h - ((v - min2) / range) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [history])

  return (
    <div className="gauge">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle cx="65" cy="65" r={R} fill="none" stroke="#182430" strokeWidth="5" strokeDasharray={`${circumference} 999`} transform="rotate(135 65 65)" strokeLinecap="round" />
        <circle
          cx="65" cy="65" r={R} fill="none" stroke={`url(#${gid})`} strokeWidth="5"
          strokeDasharray={`${dash} 999`} transform="rotate(135 65 65)" strokeLinecap="round"
          className="gauge-arc" style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-value" style={{ color }}>{value}</div>
        {spark && (
          <svg className="gauge-spark" width="70" height="20" viewBox="0 0 70 20" preserveAspectRatio="none">
            <path d={spark} fill="none" stroke={color} strokeWidth="1.5" opacity="0.85" />
          </svg>
        )}
      </div>
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

    .portal-actions { display: flex; gap: 14px; align-items: center; }
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

    .gauge { display: flex; flex-direction: column; align-items: center; padding-top: 4px; position: relative; }
    .gauge-arc {
      transition: stroke-dasharray 1.1s cubic-bezier(.34,1.2,.64,1);
      animation: gauge-breathe 3.2s ease-in-out infinite;
    }
    @keyframes gauge-breathe {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.35); }
    }
    .gauge-center {
      position: absolute; top: 0; left: 0; width: 130px; height: 130px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    }
    .gauge-value {
      font-family: 'Orbitron', sans-serif; font-size: 27px; font-weight: 800; line-height: 1;
      text-shadow: 0 0 14px currentColor;
    }
    .gauge-spark { opacity: 0.9; }
    .gauge-label {
      font-family: 'DM Mono', monospace; font-size: 9px; color: var(--text-dim);
      letter-spacing: 1.5px; text-transform: uppercase; margin-top: 6px; text-align: center;
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

    .live-clock {
      text-align: right; font-family: 'Orbitron', sans-serif; line-height: 1;
      padding-right: 4px;
    }
    .live-clock-time {
      font-size: 20px; font-weight: 700; color: var(--teal); letter-spacing: 1px;
      text-shadow: 0 0 12px rgba(0,229,184,.3);
    }
    .live-clock-date {
      font-family: 'DM Mono', monospace; font-size: 9px; color: var(--text-dim);
      letter-spacing: 1px; text-transform: uppercase; margin-top: 3px;
    }

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
  const [history, setHistory] = useState({ otsActivas: [], docsHoy: [], otsConcluidasMes: [] })
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return window.localStorage.getItem(THEME_KEY) || 'dark'
  })
  const navigate = useNavigate()
  const esGerencia = profile?.area === 'gerencia'
  const veFacturas = AREAS_VEN_FACTURAS.includes(profile?.area)
  const esContabilidad = profile?.area === 'contabilidad'

  const [avisoFacturas, setAvisoFacturas] = useState(null)
  const [avisoDescartado, setAvisoDescartado] = useState(false)

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
      const nuevo = {
        otsActivas: otsActivas.count ?? 0,
        docsHoy: docsHoy.count ?? 0,
        otsConcluidasMes: otsConcluidasMes.count ?? 0,
      }
      setStats(nuevo)
      setHistory((prev) => ({
        otsActivas: [...prev.otsActivas, nuevo.otsActivas].slice(-16),
        docsHoy: [...prev.docsHoy, nuevo.docsHoy].slice(-16),
        otsConcluidasMes: [...prev.otsConcluidasMes, nuevo.otsConcluidasMes].slice(-16),
      }))
    }
    cargarStats()
    const t = setInterval(cargarStats, 60000)
    return () => clearInterval(t)
  }, [])

  // ── Aviso de facturas vencidas/por vencer — solo para Contabilidad ──────
  // Se calcula ni bien entra al Portal, sin depender de que abra Seguimiento
  // de Facturas. Umbral de "por vencer" alineado con el de esa herramienta
  // (7 días).
  useEffect(() => {
    if (!esContabilidad) return
    async function cargarAvisoFacturas() {
      const { data, error } = await supabase
        .from('cobranza')
        .select('fecha_vencimiento, monto, monto_detraccion, estado')
        .neq('estado', 'cobrado')
      if (error) {
        console.error('No se pudo cargar aviso de facturas:', error)
        return
      }
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
      let vencidas = 0, porVencer = 0, montoVencido = 0
      for (const c of data || []) {
        if (!c.fecha_vencimiento) continue
        const f = new Date(c.fecha_vencimiento + 'T00:00:00')
        const dias = Math.round((f - hoy) / 86400000)
        const monto = Number(c.monto || 0) - Number(c.monto_detraccion || 0)
        if (dias < 0) { vencidas++; montoVencido += monto }
        else if (dias <= 7) { porVencer++ }
      }
      setAvisoFacturas({ vencidas, porVencer, montoVencido })
    }
    cargarAvisoFacturas()
  }, [esContabilidad])

  // Abre la herramienta como ventana tipo "app" (sin barra de pestañas/direcciones,
  // en la medida que el navegador lo permite vía window.open). Las rutas internas
  // (que empiezan con "/") siguen navegando dentro de la misma app con React Router.
  function abrir(url) {
    playSelectSound()
    if (url.startsWith('/')) {
      navigate(url)
      return
    }
    const w = 1280, h = 800
    const left = (window.screen.width - w) / 2
    const top = (window.screen.height - h) / 2
    const features = [
      'popup=yes',
      'noopener',
      `width=${w}`,
      `height=${h}`,
      `left=${left}`,
      `top=${top}`,
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
      'resizable=yes',
      'scrollbars=yes',
    ].join(',')
    window.open(url, '_blank', features)
  }

  return (
    <div className="portal-wrap" data-theme={theme}>
      <CSS />
      <WaveBackground />
      <div className="portal-grid-bg" />
      <div className="portal-glow" />
      <div className="portal-inner">

        {esContabilidad && avisoFacturas && !avisoDescartado && (avisoFacturas.vencidas > 0 || avisoFacturas.porVencer > 0) && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              background: avisoFacturas.vencidas > 0 ? 'rgba(255,59,78,0.1)' : 'rgba(240,165,0,0.1)',
              border: `1px solid ${avisoFacturas.vencidas > 0 ? 'rgba(255,59,78,0.35)' : 'rgba(240,165,0,0.35)'}`,
              borderRadius: 12, padding: '14px 18px', marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 22, flexShrink: 0 }}>{avisoFacturas.vencidas > 0 ? '🔴' : '🟡'}</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                {avisoFacturas.vencidas > 0
                  ? `Tienes ${avisoFacturas.vencidas} factura${avisoFacturas.vencidas !== 1 ? 's' : ''} vencida${avisoFacturas.vencidas !== 1 ? 's' : ''}`
                  : `${avisoFacturas.porVencer} factura${avisoFacturas.porVencer !== 1 ? 's' : ''} por vencer esta semana`}
                {avisoFacturas.vencidas > 0 && avisoFacturas.porVencer > 0 && ` · ${avisoFacturas.porVencer} por vencer esta semana`}
              </div>
              {avisoFacturas.vencidas > 0 && (
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Monto vencido pendiente: S/ {avisoFacturas.montoVencido.toFixed(2)}
                </div>
              )}
            </div>
            <button
              className="portal-btn"
              style={{ borderColor: avisoFacturas.vencidas > 0 ? 'rgba(255,59,78,0.4)' : 'rgba(240,165,0,0.4)' }}
              onClick={() => { playSelectSound(); navigate('/facturas') }}
            >
              Ver ahora →
            </button>
            <button
              className="theme-toggle"
              style={{ width: 28, height: 28, fontSize: 13 }}
              title="Descartar por esta vez"
              onClick={() => setAvisoDescartado(true)}
            >
              ✕
            </button>
          </div>
        )}

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
            <LiveClock />
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
          <Gauge label="OTs activas" value={stats.otsActivas} max={Math.max(stats.otsActivas * 1.4, 10)} color="#ff3b4e" history={history.otsActivas} />
          <Gauge label="Docs. subidos hoy" value={stats.docsHoy} max={Math.max(stats.docsHoy * 1.4, 15)} color="#00e5b8" history={history.docsHoy} />
          <Gauge label="OTs concluidas (mes)" value={stats.otsConcluidasMes} max={Math.max(stats.otsConcluidasMes * 1.4, 10)} color="#f0a500" history={history.otsConcluidasMes} />
        </div>

        {loading && <p style={{ color: 'var(--text-dim)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>Cargando herramientas...</p>}

        {!loading && (
          <div className="tools-grid">
            {/* ── Seguimiento de Facturas: solo Contabilidad y Gerencia ── */}
            {veFacturas && (
              <div
                className="tool-card"
                onClick={() => abrir('/facturas')}
                onMouseEnter={playHoverSound}
              >
                <div className="tool-icon">🧾</div>
                <div className="tool-name">Seguimiento de Facturas</div>
              </div>
            )}
            {herramientas.map((h) => (
              <div
                key={h.id}
                className="tool-card"
                onClick={() => abrir(h.url)}
                onMouseEnter={playHoverSound}
              >
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