import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// ── Roles con acceso a esta herramienta ────────────────────────────────────
// 'contabilidad' puede editar (marcar cobrado, corregir datos desde aquí no
// está incluido en esta versión — la edición fina de una factura sigue
// haciéndose en la OT). 'gerencia' (que también es el área de la cuenta
// admin@) accede en modo solo lectura.
const AREA_EDITA = 'contabilidad'
const AREAS_PERMITIDAS = ['contabilidad', 'gerencia']

const DIAS_UMBRAL_POR_VENCER = 7

function hoyISO() {
  return new Date().toISOString().split('T')[0]
}

function diasHasta(fechaStr) {
  if (!fechaStr) return null
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const fecha = new Date(fechaStr + 'T00:00:00')
  return Math.round((fecha - hoy) / 86400000)
}

function calcularSemaforo(c) {
  if (c.estado === 'cobrado') {
    return { key: 'cobrado', label: '✅ Cobrado', color: '#4ade80' }
  }
  const dias = diasHasta(c.fecha_vencimiento)
  if (dias == null) return { key: 'sin_fecha', label: '— Sin fecha', color: '#94a3b8' }
  if (dias < 0) {
    return { key: 'vencido', label: `⚠ Vencida hace ${Math.abs(dias)}d`, color: '#f87171' }
  }
  if (dias <= DIAS_UMBRAL_POR_VENCER) {
    return { key: 'por_vencer', label: dias === 0 ? '⏰ Vence hoy' : `⏰ Vence en ${dias}d`, color: '#facc15' }
  }
  return { key: 'pendiente', label: 'Pendiente', color: '#94a3b8' }
}

function montoACobrar(c) {
  if (c.monto == null) return 0
  return Number(c.monto) - Number(c.monto_detraccion || 0)
}

function fmtMoneda(valor, moneda) {
  const signo = moneda === 'USD' ? 'US$' : 'S/'
  return `${signo} ${Number(valor || 0).toFixed(2)}`
}

function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function mesActualValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || 'var(--ocean-accent)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function SeguimientoFacturas({ profile, onLogout }) {
  const navigate = useNavigate()
  const [cobranzas, setCobranzas] = useState([])
  const [clientesPorOT, setClientesPorOT] = useState({})
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(mesActualValue())
  const [filtroEstado, setFiltroEstado] = useState('todas') // todas | vencido | por_vencer | pendiente | cobrado
  const [busqueda, setBusqueda] = useState('')
  const [guardandoId, setGuardandoId] = useState(null)

  const acceso = AREAS_PERMITIDAS.includes(profile?.area)
  const puedeEditar = profile?.area === AREA_EDITA

  async function cargarDatos() {
    setLoading(true)
    const { data, error } = await supabase
      .from('cobranza')
      .select('*')
      .order('fecha_vencimiento', { ascending: true })

    if (error) {
      console.error('Error cargando cobranzas:', error)
      setLoading(false)
      return
    }

    const filas = data || []
    setCobranzas(filas)

    const otNumbers = [...new Set(filas.map((c) => c.ot_number).filter(Boolean))]
    if (otNumbers.length > 0) {
      const { data: servicios } = await supabase
        .from('services')
        .select('ot_number, client, ruc')
        .in('ot_number', otNumbers)
      const mapa = {}
      for (const s of servicios || []) mapa[s.ot_number] = s
      setClientesPorOT(mapa)
    }

    setLoading(false)
  }

  useEffect(() => {
    if (!acceso) return
    cargarDatos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceso])

  async function marcarCobrado(c) {
    if (!confirm(`¿Confirmas que la factura ${c.numero_factura} (OT ${c.ot_number}) ya fue cobrada?`)) return
    setGuardandoId(c.id)
    const { error } = await supabase
      .from('cobranza')
      .update({ estado: 'cobrado', fecha_cobro: hoyISO() })
      .eq('id', c.id)
    if (error) {
      alert('No se pudo actualizar: ' + error.message)
    } else {
      cargarDatos()
    }
    setGuardandoId(null)
  }

  // ── KPIs del mes seleccionado ──────────────────────────────────────────
  const kpisMes = useMemo(() => {
    const [anio, mesNum] = mes.split('-').map(Number)
    const dentroDeMes = (fechaStr) => {
      if (!fechaStr) return false
      const d = new Date(fechaStr + 'T00:00:00')
      return d.getFullYear() === anio && d.getMonth() + 1 === mesNum
    }

    const emitidasEnMes = cobranzas.filter((c) => dentroDeMes(c.fecha_emision))
    const cobradasEnMes = cobranzas.filter((c) => c.estado === 'cobrado' && dentroDeMes(c.fecha_cobro))

    const igvMes = emitidasEnMes.reduce((acc, c) => acc + Number(c.igv || 0), 0)
    const detraccionMes = emitidasEnMes.reduce((acc, c) => acc + Number(c.monto_detraccion || 0), 0)
    const facturadoMes = emitidasEnMes.reduce((acc, c) => acc + Number(c.monto || 0), 0)
    const cobradoMes = cobradasEnMes.reduce((acc, c) => acc + montoACobrar(c), 0)

    return {
      cantidadEmitidas: emitidasEnMes.length,
      igvMes,
      detraccionMes,
      facturadoMes,
      cobradoMes,
      cantidadCobradas: cobradasEnMes.length,
    }
  }, [cobranzas, mes])

  // ── KPIs globales (no dependen del mes) ─────────────────────────────────
  const kpisGlobales = useMemo(() => {
    const pendientes = cobranzas.filter((c) => c.estado !== 'cobrado')
    const vencidas = pendientes.filter((c) => calcularSemaforo(c).key === 'vencido')
    const porVencer = pendientes.filter((c) => calcularSemaforo(c).key === 'por_vencer')
    const montoPendienteTotal = pendientes.reduce((acc, c) => acc + montoACobrar(c), 0)
    const montoVencidoTotal = vencidas.reduce((acc, c) => acc + montoACobrar(c), 0)
    return {
      totalPendientes: pendientes.length,
      totalVencidas: vencidas.length,
      totalPorVencer: porVencer.length,
      montoPendienteTotal,
      montoVencidoTotal,
    }
  }, [cobranzas])

  // ── Filtrado de la tabla ─────────────────────────────────────────────
  const filasFiltradas = useMemo(() => {
    return cobranzas.filter((c) => {
      const semaforo = calcularSemaforo(c)
      if (filtroEstado !== 'todas' && semaforo.key !== filtroEstado) return false
      if (busqueda.trim()) {
        const q = busqueda.trim().toLowerCase()
        const cliente = clientesPorOT[c.ot_number]?.client || c.cliente_nombre || ''
        const enOT = (c.ot_number || '').toLowerCase().includes(q)
        const enFactura = (c.numero_factura || '').toLowerCase().includes(q)
        const enCliente = cliente.toLowerCase().includes(q)
        if (!enOT && !enFactura && !enCliente) return false
      }
      return true
    })
  }, [cobranzas, filtroEstado, busqueda, clientesPorOT])

  function exportarCSV() {
    const cols = ['OT', 'Cliente', 'RUC Cliente', 'N° Factura', 'Emisión', 'Vencimiento', 'Condición', 'Moneda', 'Valor Venta', 'IGV', 'Monto Total', '% Detracción', 'Monto Detracción', 'Monto a Cobrar', 'Estado', 'Fecha Cobro', 'Glosa']
    const filas = filasFiltradas.map((c) => [
      c.ot_number || '',
      clientesPorOT[c.ot_number]?.client || c.cliente_nombre || '',
      c.ruc_cliente || '',
      c.numero_factura || '',
      c.fecha_emision || '',
      c.fecha_vencimiento || '',
      c.condicion_pago || '',
      c.moneda || '',
      c.valor_venta ?? '',
      c.igv ?? '',
      c.monto ?? '',
      c.porcentaje_detraccion ?? '',
      c.monto_detraccion ?? '',
      montoACobrar(c).toFixed(2),
      c.estado || '',
      c.fecha_cobro || '',
      c.glosa || '',
    ])
    const csv = [cols, ...filas].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Seguimiento_Facturas_${mes}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!acceso) {
    return (
      <div className="container" style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
        <h2>Acceso no autorizado</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Esta herramienta es solo para Contabilidad y Gerencia.
        </p>
        <a className="link-back" onClick={() => navigate('/')}>&larr; Volver al panel</a>
      </div>
    )
  }

  return (
    <div className="container container-ancho" style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div className="top-bar" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <a className="link-back" onClick={() => navigate('/')}>&larr; Volver al panel</a>
          <h2 style={{ margin: '8px 0 0' }}>💰 Seguimiento de Facturas</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            {puedeEditar ? 'Contabilidad' : 'Vista de solo lectura — Gerencia'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={exportarCSV}>⬇ Exportar CSV</button>
          {onLogout && <button className="btn btn-secondary" onClick={onLogout}>Salir</button>}
        </div>
      </div>

      {/* ── KPIs globales ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '20px 0' }}>
        <KpiCard label="Facturas pendientes" value={kpisGlobales.totalPendientes} sub={fmtMoneda(kpisGlobales.montoPendienteTotal, 'PEN')} />
        <KpiCard label="Vencidas" value={kpisGlobales.totalVencidas} sub={fmtMoneda(kpisGlobales.montoVencidoTotal, 'PEN')} color="#f87171" />
        <KpiCard label={`Por vencer (≤${DIAS_UMBRAL_POR_VENCER}d)`} value={kpisGlobales.totalPorVencer} color="#facc15" />
      </div>

      {/* ── KPIs del mes seleccionado ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div className="otdetail-section-label" style={{ margin: 0 }}>Resumen del mes</div>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: 160 }} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiCard label="Facturas emitidas" value={kpisMes.cantidadEmitidas} />
          <KpiCard label="Facturado" value={fmtMoneda(kpisMes.facturadoMes, 'PEN')} />
          <KpiCard label="IGV del mes" value={fmtMoneda(kpisMes.igvMes, 'PEN')} color="#a78bfa" />
          <KpiCard label="Detracciones del mes" value={fmtMoneda(kpisMes.detraccionMes, 'PEN')} color="#f97316" />
          <KpiCard label="Cobrado en el mes" value={fmtMoneda(kpisMes.cobradoMes, 'PEN')} sub={`${kpisMes.cantidadCobradas} factura(s)`} color="#4ade80" />
        </div>
      </div>

      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            ['todas', 'Todas'],
            ['vencido', '⚠ Vencidas'],
            ['por_vencer', '⏰ Por vencer'],
            ['pendiente', 'Pendientes'],
            ['cobrado', '✅ Cobradas'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={filtroEstado === k ? 'btn' : 'btn btn-secondary'}
              style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => setFiltroEstado(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por OT, cliente o N° factura..."
          style={{ maxWidth: 280, marginLeft: 'auto' }}
        />
      </div>

      {/* ── Tabla ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 16, color: 'var(--text-muted)' }}>Cargando...</p>
        ) : filasFiltradas.length === 0 ? (
          <p style={{ padding: 16, color: 'var(--text-muted)' }}>No hay facturas que coincidan con el filtro.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['OT', 'Cliente', 'N° Factura', 'Emisión', 'Vencimiento', 'Condición', 'Monto', 'IGV', 'Detracción', 'Monto a cobrar', 'Estado', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase',
                        letterSpacing: 1, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((c) => {
                  const semaforo = calcularSemaforo(c)
                  const cliente = clientesPorOT[c.ot_number]?.client || c.cliente_nombre || '—'
                  return (
                    <tr key={c.id}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                        <a onClick={() => navigate(`/ot/${c.ot_number}`)} style={{ cursor: 'pointer', color: 'var(--ocean-accent)' }}>
                          {c.ot_number}
                        </a>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cliente}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontFamily: 'monospace' }}>{c.numero_factura}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtFecha(c.fecha_emision)}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtFecha(c.fecha_vencimiento)}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.condicion_pago}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(c.monto, c.moneda)}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{c.igv != null ? fmtMoneda(c.igv, c.moneda) : '—'}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                        {c.monto_detraccion != null ? fmtMoneda(c.monto_detraccion, c.moneda) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--ocean-accent)' }}>
                        {fmtMoneda(montoACobrar(c), c.moneda)}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: semaforo.color, background: `${semaforo.color}22`, borderRadius: 20, padding: '3px 10px' }}>
                          {semaforo.label}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                        {puedeEditar && c.estado !== 'cobrado' && (
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: 11, padding: '4px 10px' }}
                            disabled={guardandoId === c.id}
                            onClick={() => marcarCobrado(c)}
                          >
                            {guardandoId === c.id ? '...' : '✓ Cobrado'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
