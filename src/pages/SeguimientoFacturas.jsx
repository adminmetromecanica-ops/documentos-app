import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// ── Roles con acceso a esta herramienta ────────────────────────────────────
// 'contabilidad' puede editar (marcar cobrado). 'gerencia' (que también es el
// área de la cuenta admin@) accede en modo solo lectura.
const AREA_EDITA = 'contabilidad'
const AREAS_PERMITIDAS = ['contabilidad', 'gerencia']

const DIAS_UMBRAL_POR_VENCER = 7

// Estados de OT en los que ya debería existir una factura (o estar por
// generarse pronto). Antes de "pendiente-fact" el servicio normalmente aún
// está en laboratorio y no corresponde facturar todavía.
const ESTADOS_DEBERIA_FACTURAR = ['pendiente-fact', 'concluido']

const STATUS_LABEL = {
  programado: 'Programado',
  'en-proceso': 'En Proceso',
  'pendiente-cert': 'Pend. Certificado',
  'pendiente-fact': 'Pend. Facturación',
  concluido: 'Concluido',
}

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

const MESES_LABEL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// ── Resumen Mensual (año completo) — rescatado de FACTUTRACK PRO ──────────
// Reproduce las mismas columnas y fórmulas de la hoja "RESUMEN MENSUAL":
// NETO = MONTO - DETRACCIÓN (lo que corresponde descontando la detracción)
// SALDO = MONTO - COBRADO (lo que falta cobrar en total, sin descontar
// detracción, tal como lo calculaba el Excel original).
function calcularResumenMensual(cobranzas, anio) {
  return MESES_LABEL.map((label, idx) => {
    const filas = cobranzas.filter((c) => {
      if (!c.fecha_emision) return false
      const d = new Date(c.fecha_emision + 'T00:00:00')
      return d.getFullYear() === anio && d.getMonth() === idx
    })
    const montoTotal = filas.reduce((acc, c) => acc + Number(c.monto || 0), 0)
    const baseImponible = filas.reduce((acc, c) => acc + Number(c.valor_venta ?? (c.monto || 0) - (c.igv || 0)), 0)
    const igv = filas.reduce((acc, c) => acc + Number(c.igv || 0), 0)
    const detraccion = filas.reduce((acc, c) => acc + Number(c.monto_detraccion || 0), 0)
    const cobrado = filas.filter((c) => c.estado === 'cobrado').reduce((acc, c) => acc + Number(c.monto || 0), 0)
    return {
      mes: label,
      facturas: filas.length,
      montoTotal,
      baseImponible,
      igv,
      detraccion,
      neto: montoTotal - detraccion,
      cobrado,
      saldo: montoTotal - cobrado,
    }
  })
}

// ── Resumen Anual (histórico completo) ────────────────────────────────────
function calcularResumenAnual(cobranzas) {
  const porAnio = {}
  cobranzas.forEach((c) => {
    if (!c.fecha_emision) return
    const anio = new Date(c.fecha_emision + 'T00:00:00').getFullYear()
    if (!porAnio[anio]) porAnio[anio] = []
    porAnio[anio].push(c)
  })
  return Object.entries(porAnio)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([anio, filas]) => {
      const montoTotal = filas.reduce((acc, c) => acc + Number(c.monto || 0), 0)
      const baseImponible = filas.reduce((acc, c) => acc + Number(c.valor_venta ?? (c.monto || 0) - (c.igv || 0)), 0)
      const igv = filas.reduce((acc, c) => acc + Number(c.igv || 0), 0)
      const detraccion = filas.reduce((acc, c) => acc + Number(c.monto_detraccion || 0), 0)
      const cobrado = filas.filter((c) => c.estado === 'cobrado').reduce((acc, c) => acc + Number(c.monto || 0), 0)
      return {
        anio: Number(anio),
        facturas: filas.length,
        montoTotal,
        baseImponible,
        igv,
        detraccion,
        neto: montoTotal - detraccion,
        cobrado,
        saldo: montoTotal - cobrado,
      }
    })
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

// ── Recordatorios de cobro por WhatsApp / correo ──────────────────────────
// Arma el mensaje y abre el enlace correspondiente — no hay envío automático
// ni backend involucrado, así que no hace falta ningún permiso adicional;
// el usuario revisa el mensaje antes de enviarlo, tal como abriría WhatsApp
// o su correo manualmente.
function normalizarTelefonoWhatsApp(telefono) {
  if (!telefono) return null
  const soloDigitos = telefono.replace(/[^\d]/g, '')
  if (!soloDigitos) return null
  // Si ya trae código de país (empieza con 51 y tiene 11 dígitos) lo dejamos
  // tal cual; si parece un celular peruano de 9 dígitos, le anteponemos 51.
  if (soloDigitos.length === 9) return `51${soloDigitos}`
  return soloDigitos
}

function armarMensajeRecordatorio(c, cliente, semaforo) {
  const monto = fmtMoneda(montoACobrar(c), c.moneda)
  const vencimiento = fmtFecha(c.fecha_vencimiento)
  if (semaforo.key === 'vencido') {
    return `Hola${cliente ? ' ' + cliente : ''}, le escribimos de MetroMecánica respecto a la factura ${c.numero_factura} por ${monto}, cuyo vencimiento fue el ${vencimiento}. Quedamos atentos para coordinar el pago. Gracias.`
  }
  return `Hola${cliente ? ' ' + cliente : ''}, le recordamos de MetroMecánica que la factura ${c.numero_factura} por ${monto} vence el ${vencimiento}. Quedamos atentos. Gracias.`
}

function BotonesRecordatorio({ c, cliente, semaforo }) {
  const telefono = normalizarTelefonoWhatsApp(c.cliente_telefono)
  const correo = c.cliente_correo
  if (!telefono && !correo) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sin contacto</span>
  }
  const mensaje = armarMensajeRecordatorio(c, cliente, semaforo)
  const linkWhatsApp = telefono ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}` : null
  const linkCorreo = correo
    ? `mailto:${correo}?subject=${encodeURIComponent(`Recordatorio de pago — Factura ${c.numero_factura}`)}&body=${encodeURIComponent(mensaje)}`
    : null
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {linkWhatsApp && (
        <a
          href={linkWhatsApp}
          target="_blank"
          rel="noreferrer"
          title={`Enviar recordatorio por WhatsApp a ${c.cliente_telefono}`}
          className="btn btn-secondary"
          style={{ fontSize: 11, padding: '4px 8px', textDecoration: 'none' }}
        >
          💬
        </a>
      )}
      {linkCorreo && (
        <a
          href={linkCorreo}
          title={`Enviar recordatorio por correo a ${correo}`}
          className="btn btn-secondary"
          style={{ fontSize: 11, padding: '4px 8px', textDecoration: 'none' }}
        >
          📧
        </a>
      )}
    </div>
  )
}

export default function SeguimientoFacturas({ profile, onLogout }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState('facturas') // 'facturas' | 'sin_factura' | 'reportes'
  const [anioReportes, setAnioReportes] = useState(new Date().getFullYear())
  const [cobranzas, setCobranzas] = useState([])
  const [servicios, setServicios] = useState([])
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

    const [{ data: cobranzasData, error: errCobranzas }, { data: serviciosData, error: errServicios }] = await Promise.all([
      supabase.from('cobranza').select('*').order('fecha_vencimiento', { ascending: true }),
      supabase.from('services').select('id, ot_number, client, ruc, status, due_date, created_at, updated_at'),
    ])

    if (errCobranzas) console.error('Error cargando cobranzas:', errCobranzas)
    if (errServicios) console.error('Error cargando servicios:', errServicios)

    const filas = cobranzasData || []
    const svcs = serviciosData || []
    setCobranzas(filas)
    setServicios(svcs)

    const mapa = {}
    for (const s of svcs) mapa[s.ot_number] = s
    setClientesPorOT(mapa)

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

  // ── OTs que aún no tienen ninguna factura registrada en `cobranza` ──────
  // Cruce por ot_number: cualquier OT en `services` sin fila correspondiente
  // en `cobranza` se considera "sin factura", sin depender de que alguien
  // haya actualizado manualmente el estado a tiempo.
  const otsSinFactura = useMemo(() => {
    const otsConFactura = new Set(cobranzas.map((c) => c.ot_number))
    return servicios.filter((s) => s.ot_number && !otsConFactura.has(s.ot_number))
  }, [cobranzas, servicios])

  const otsSinFacturaUrgentes = useMemo(
    () => otsSinFactura.filter((s) => ESTADOS_DEBERIA_FACTURAR.includes(s.status)),
    [otsSinFactura]
  )

  const otsSinFacturaFiltradas = useMemo(() => {
    return otsSinFactura.filter((s) => {
      if (busqueda.trim()) {
        const q = busqueda.trim().toLowerCase()
        const enOT = (s.ot_number || '').toLowerCase().includes(q)
        const enCliente = (s.client || '').toLowerCase().includes(q)
        if (!enOT && !enCliente) return false
      }
      return true
    })
  }, [otsSinFactura, busqueda])

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
    const sinContacto = pendientes.filter((c) => !c.cliente_correo && !c.cliente_telefono)
    const montoPendienteTotal = pendientes.reduce((acc, c) => acc + montoACobrar(c), 0)
    const montoVencidoTotal = vencidas.reduce((acc, c) => acc + montoACobrar(c), 0)
    return {
      totalPendientes: pendientes.length,
      totalVencidas: vencidas.length,
      totalPorVencer: porVencer.length,
      totalSinContacto: sinContacto.length,
      montoPendienteTotal,
      montoVencidoTotal,
    }
  }, [cobranzas])

  // ── Filtrado de la tabla de facturas ─────────────────────────────────
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

  function exportarSinFacturaCSV() {
    const cols = ['OT', 'Cliente', 'RUC', 'Estado', 'Fecha Entrega', 'Creado']
    const filas = otsSinFacturaFiltradas.map((s) => [
      s.ot_number || '',
      s.client || '',
      s.ruc || '',
      STATUS_LABEL[s.status] || s.status || '',
      s.due_date || '',
      s.created_at ? s.created_at.split('T')[0] : '',
    ])
    const csv = [cols, ...filas].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `OTs_sin_factura_${hoyISO()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const resumenMensualAnio = useMemo(() => calcularResumenMensual(cobranzas, anioReportes), [cobranzas, anioReportes])
  const resumenAnual = useMemo(() => calcularResumenAnual(cobranzas), [cobranzas])
  const aniosDisponibles = useMemo(() => {
    const anios = new Set(resumenAnual.map((r) => r.anio))
    anios.add(new Date().getFullYear())
    return Array.from(anios).sort((a, b) => b - a)
  }, [resumenAnual])

  function exportarResumenMensualCSV() {
    const cols = ['Mes', 'Facturas', 'Monto Total', 'Base Imponible', 'IGV', 'Detracción', 'Neto', 'Cobrado', 'Saldo']
    const filas = resumenMensualAnio.map((r) => [r.mes, r.facturas, r.montoTotal.toFixed(2), r.baseImponible.toFixed(2), r.igv.toFixed(2), r.detraccion.toFixed(2), r.neto.toFixed(2), r.cobrado.toFixed(2), r.saldo.toFixed(2)])
    const csv = [cols, ...filas].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Resumen_Mensual_${anioReportes}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportarResumenAnualCSV() {
    const cols = ['Año', 'Facturas', 'Monto Total', 'Base Imponible', 'IGV', 'Detracción', 'Neto', 'Cobrado', 'Saldo']
    const filas = resumenAnual.map((r) => [r.anio, r.facturas, r.montoTotal.toFixed(2), r.baseImponible.toFixed(2), r.igv.toFixed(2), r.detraccion.toFixed(2), r.neto.toFixed(2), r.cobrado.toFixed(2), r.saldo.toFixed(2)])
    const csv = [cols, ...filas].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Resumen_Anual.csv`
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
          {onLogout && <button className="btn btn-secondary" onClick={onLogout}>Salir</button>}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, margin: '20px 0 16px', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setTab('facturas')}
          style={{
            padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: 700, fontSize: 13,
            color: tab === 'facturas' ? 'var(--ocean-accent)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === 'facturas' ? 'var(--ocean-accent)' : 'transparent'}`,
          }}
        >
          🧾 Facturas registradas
        </button>
        <button
          onClick={() => setTab('sin_factura')}
          style={{
            padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: 700, fontSize: 13,
            color: tab === 'sin_factura' ? 'var(--ocean-accent)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === 'sin_factura' ? 'var(--ocean-accent)' : 'transparent'}`,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          🚫 OTs sin factura
          {otsSinFacturaUrgentes.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, background: '#f87171', color: '#1a0505',
              borderRadius: 999, padding: '1px 7px', minWidth: 18, textAlign: 'center',
            }}>
              {otsSinFacturaUrgentes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('reportes')}
          style={{
            padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: 700, fontSize: 13,
            color: tab === 'reportes' ? 'var(--ocean-accent)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === 'reportes' ? 'var(--ocean-accent)' : 'transparent'}`,
          }}
        >
          📊 Reportes IGV / Anual
        </button>
      </div>

      {tab === 'facturas' && (
        <>
          {/* ── KPIs globales ── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <KpiCard label="Facturas pendientes" value={kpisGlobales.totalPendientes} sub={fmtMoneda(kpisGlobales.montoPendienteTotal, 'PEN')} />
            <KpiCard label="Vencidas" value={kpisGlobales.totalVencidas} sub={fmtMoneda(kpisGlobales.montoVencidoTotal, 'PEN')} color="#f87171" />
            <KpiCard label={`Por vencer (≤${DIAS_UMBRAL_POR_VENCER}d)`} value={kpisGlobales.totalPorVencer} color="#facc15" />
            <KpiCard label="OTs sin factura" value={otsSinFactura.length} sub={`${otsSinFacturaUrgentes.length} ya deberían tenerla`} color="#f97316" />
            <KpiCard label="Pendientes sin contacto" value={kpisGlobales.totalSinContacto} sub="Falta teléfono o correo" color="#94a3b8" />
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
            <button className="btn btn-secondary" onClick={exportarCSV}>⬇ Exportar CSV</button>
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
                      {['OT', 'Cliente', 'N° Factura', 'Emisión', 'Vencimiento', 'Condición', 'Monto', 'IGV', 'Detracción', 'Monto a cobrar', 'Estado', 'Recordar', ''].map((h) => (
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
                            {c.estado !== 'cobrado' && <BotonesRecordatorio c={c} cliente={cliente} semaforo={semaforo} />}
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
        </>
      )}

      {tab === 'sin_factura' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <KpiCard label="Total OTs sin factura" value={otsSinFactura.length} />
            <KpiCard
              label="Deberían tener factura ya"
              value={otsSinFacturaUrgentes.length}
              sub="Estado: Pend. Facturación o Concluido"
              color="#f87171"
            />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por OT o cliente..."
              style={{ maxWidth: 280 }}
            />
            <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={exportarSinFacturaCSV}>⬇ Exportar CSV</button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <p style={{ padding: 16, color: 'var(--text-muted)' }}>Cargando...</p>
            ) : otsSinFacturaFiltradas.length === 0 ? (
              <p style={{ padding: 16, color: 'var(--text-muted)' }}>Todas las OTs tienen factura registrada. 🎉</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['OT', 'Cliente', 'RUC', 'Estado', 'Fecha Entrega', ''].map((h) => (
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
                    {otsSinFacturaFiltradas
                      .slice()
                      .sort((a, b) => {
                        const aUrge = ESTADOS_DEBERIA_FACTURAR.includes(a.status) ? 0 : 1
                        const bUrge = ESTADOS_DEBERIA_FACTURAR.includes(b.status) ? 0 : 1
                        return aUrge - bUrge
                      })
                      .map((s) => {
                        const urge = ESTADOS_DEBERIA_FACTURAR.includes(s.status)
                        return (
                          <tr key={s.id}>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                              <a onClick={() => navigate(`/ot/${s.ot_number}`)} style={{ cursor: 'pointer', color: 'var(--ocean-accent)' }}>
                                {s.ot_number}
                              </a>
                            </td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.client || '—'}
                            </td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontFamily: 'monospace' }}>{s.ruc || '—'}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                              {STATUS_LABEL[s.status] || s.status || '—'}
                            </td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtFecha(s.due_date)}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                              {urge && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', background: '#f8717122', borderRadius: 20, padding: '3px 10px' }}>
                                  🚫 Falta subir
                                </span>
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
        </>
      )}

      {tab === 'reportes' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 14 }}>IGV & Detracciones — Resumen Mensual</strong>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                Calculado según la fecha de emisión de cada factura.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={anioReportes} onChange={(e) => setAnioReportes(Number(e.target.value))} style={{ width: 110 }}>
                {aniosDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <button className="btn btn-secondary" onClick={exportarResumenMensualCSV}>⬇ CSV</button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Mes', 'Facturas', 'Monto Total', 'Base Imponible', 'IGV', 'Detracción', 'Neto', 'Cobrado', 'Saldo'].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resumenMensualAnio.map((r) => (
                    <tr key={r.mes} style={{ opacity: r.facturas === 0 ? 0.45 : 1 }}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700 }}>{r.mes}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.facturas}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(r.montoTotal, 'PEN')}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(r.baseImponible, 'PEN')}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', color: '#a78bfa' }}>{fmtMoneda(r.igv, 'PEN')}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', color: '#f97316' }}>{fmtMoneda(r.detraccion, 'PEN')}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(r.neto, 'PEN')}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', color: '#4ade80' }}>{fmtMoneda(r.cobrado, 'PEN')}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', fontWeight: 700, color: r.saldo > 0 ? '#f87171' : 'var(--text-muted)' }}>{fmtMoneda(r.saldo, 'PEN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 14 }}>Resumen Anual (histórico)</strong>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                Totales acumulados por año, desde que hay facturas registradas.
              </p>
            </div>
            <button className="btn btn-secondary" onClick={exportarResumenAnualCSV}>⬇ CSV</button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {resumenAnual.length === 0 ? (
              <p style={{ padding: 16, color: 'var(--text-muted)' }}>Aún no hay facturas registradas.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Año', 'Facturas', 'Monto Total', 'Base Imponible', 'IGV', 'Detracción', 'Neto', 'Cobrado', 'Saldo'].map((h) => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resumenAnual.map((r) => (
                      <tr key={r.anio}>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700 }}>{r.anio}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.facturas}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(r.montoTotal, 'PEN')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(r.baseImponible, 'PEN')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', color: '#a78bfa' }}>{fmtMoneda(r.igv, 'PEN')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', color: '#f97316' }}>{fmtMoneda(r.detraccion, 'PEN')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtMoneda(r.neto, 'PEN')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', color: '#4ade80' }}>{fmtMoneda(r.cobrado, 'PEN')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', fontWeight: 700, color: r.saldo > 0 ? '#f87171' : 'var(--text-muted)' }}>{fmtMoneda(r.saldo, 'PEN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}