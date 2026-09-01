import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function colorPrioridad(priority) {
  if (priority === 'alta') return '#f87171'
  if (priority === 'media') return '#facc15'
  return '#94a3b8'
}

function diasDeAtraso(due_date) {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const fecha = new Date(due_date)
  fecha.setHours(0, 0, 0, 0)
  return Math.round((hoy - fecha) / (1000 * 60 * 60 * 24))
}

// ── Semáforos por área — SOLO uno activo a la vez por persona ────────────
// Antes competía con el color de prioridad de la OT (mismo esquema rojo/
// amarillo/gris para dos cosas distintas → confuso, especialmente con baja
// visión). Cada área ve el semáforo que le corresponde a ELLA, nunca el de
// otra: Contabilidad ve estado de factura, Comercial ve estado de
// documentos (Proforma/OC). Nunca se combinan para la misma persona —
// mostrarlos juntos volvería a producir el mismo conflicto visual que ya
// corregimos una vez.
const ESTADO_FACTURA_CFG = {
  cobrado: { color: '#4ade80', titulo: 'Factura cobrada', texto: 'COBRADA', icono: '✓' },
  pendiente: { color: '#facc15', titulo: 'Factura registrada — pendiente de cobro', texto: 'FACTURADA', icono: '$' },
  sin_factura: { color: '#f87171', titulo: 'Sin factura registrada', texto: 'SIN FACTURA', icono: '!' },
}

const ESTADO_DOCS_COMERCIAL_CFG = {
  completo: { color: '#4ade80', titulo: 'Proforma y Orden de Compra subidas', texto: 'COMPLETO', icono: '✓' },
  parcial: { color: '#facc15', titulo: 'Falta Proforma u Orden de Compra (solo tiene una)', texto: 'FALTA 1', icono: '½' },
  sin_documentos: { color: '#f87171', titulo: 'Sin Proforma ni Orden de Compra subidas', texto: 'SIN DOCS', icono: '✕' },
}

const ESTADO_CERT_LAB_CFG = {
  con_certificado: { color: '#4ade80', titulo: 'Certificado de calibración subido', texto: 'CON CERTIFICADO', icono: '✓' },
  sin_certificado: { color: '#f87171', titulo: 'Sin certificado de calibración subido', texto: 'SIN CERTIFICADO', icono: '✕' },
}

// Chip grande con ícono + texto — usado donde hay espacio (modal, atrasadas)
function ChipEstado({ estado, cfg }) {
  const c = cfg[estado]
  if (!c) return null
  return (
    <span
      title={c.titulo}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.5,
        color: '#0a0e14',
        background: c.color,
        borderRadius: 6,
        padding: '3px 9px',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{c.icono}</span>
      {c.texto}
    </span>
  )
}

// Estilo de la tarjeta de una OT dentro de una celda del calendario.
// - Sin semáforo activo (overlay.activo=false): color por prioridad, como
//   siempre — para cualquier área que no sea la dueña de un semáforo.
// - Con semáforo activo: color SOLO por ese estado — fondo tintado + franja
//   lateral del mismo color, texto neutro. Nunca se mezcla con prioridad.
function estiloItemCelda(s, overlay) {
  if (overlay?.activo) {
    const estado = overlay.estadoPorOT[s.ot_number] || overlay.defaultEstado
    const cfg = overlay.cfg[estado]
    return {
      background: `${cfg.color}26`,
      borderLeft: `6px solid ${cfg.color}`,
      color: 'var(--text)',
    }
  }
  const color = colorPrioridad(s.priority)
  return {
    background: `${color}22`,
    color,
  }
}

// Estilo de fila (modal / lista de atrasadas) — misma lógica, adaptada a
// filas horizontales en vez de tarjetas de celda.
function estiloFila(overlay, estado) {
  if (!overlay?.activo) return {}
  const cfg = overlay.cfg[estado]
  return {
    borderLeft: `6px solid ${cfg.color}`,
    background: `${cfg.color}14`,
  }
}

// Modal: muestra TODAS las OT de un día, sin límite — pensado para
// días con carga alta (10, 15, 30+ servicios).
function DiaModal({ fecha, items, onClose, navigate, overlay }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ocean-2, #0f2942)', borderRadius: 12, width: '100%', maxWidth: 640,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 15 }}>{fecha} — {items.length} orden{items.length !== 1 ? 'es' : ''} de trabajo</strong>
          <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={onClose}>✕ Cerrar</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 12px' }}>
          {items.map((s) => {
            const estado = overlay?.activo ? (overlay.estadoPorOT[s.ot_number] || overlay.defaultEstado) : null
            return (
              <div
                key={s.id}
                onClick={() => navigate(`/ot/${s.ot_number}`)}
                className="doc-item"
                style={{
                  cursor: 'pointer',
                  padding: '10px 12px',
                  ...estiloFila(overlay, estado),
                }}
              >
                <div>
                  <strong>{s.ot_number}</strong>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.client}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {overlay?.activo ? (
                    <ChipEstado estado={estado} cfg={overlay.cfg} />
                  ) : (
                    <span className={`badge badge-${s.priority === 'alta' ? 'alta' : s.priority === 'media' ? 'media' : 'normal'}`}>
                      {s.priority}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Buscador global de OT — filtra sobre TODOS los servicios (no solo el
// mes que se está viendo), por N° OT, cliente o RUC. Usable por
// cualquier área ya que opera sobre el mismo array `services` que
// recibe el calendario.
function BuscadorOT({ services, onSeleccionar }) {
  const [texto, setTexto] = useState('')

  const resultados = useMemo(() => {
    const q = texto.trim().toLowerCase()
    if (q.length < 2) return []
    return services
      .filter((s) =>
        s.ot_number?.toLowerCase().includes(q) ||
        s.client?.toLowerCase().includes(q) ||
        s.ruc?.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [texto, services])

  return (
    <div style={{ position: 'relative', marginBottom: 16 }}>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="🔍 Buscar OT por número, cliente o RUC..."
        style={{
          width: '100%',
          fontSize: 14,
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--ocean-2, #0f2942)',
          color: 'var(--text)',
          outline: 'none',
        }}
      />
      {resultados.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--ocean-2, #0f2942)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          }}
        >
          {resultados.map((s) => (
            <div
              key={s.id}
              onClick={() => { setTexto(''); onSeleccionar(s) }}
              className="doc-item"
              style={{ cursor: 'pointer', padding: '10px 14px' }}
            >
              <div>
                <strong style={{ color: colorPrioridad(s.priority) }}>{s.ot_number}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {s.client}{s.ruc ? ` · RUC: ${s.ruc}` : ''}
                </div>
              </div>
              <span className={`badge badge-${s.priority === 'alta' ? 'alta' : s.priority === 'media' ? 'media' : 'normal'}`}>
                {s.priority}
              </span>
            </div>
          ))}
        </div>
      )}
      {texto.trim().length >= 2 && resultados.length === 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          Sin resultados para "{texto}".
        </div>
      )}
    </div>
  )
}

export default function CalendarView({ services, profile }) {
  const [mesActual, setMesActual] = useState(new Date())
  const [diaSeleccionado, setDiaSeleccionado] = useState(null) // { fecha, items } | null
  const [facturaPorOT, setFacturaPorOT] = useState({})
  const [docsComercialPorOT, setDocsComercialPorOT] = useState({})
  const [certLabPorOT, setCertLabPorOT] = useState({})
  const [vistaGerencia, setVistaGerencia] = useState('ninguno')
  const navigate = useNavigate()

  const esGerencia = profile?.area === 'gerencia'
  // Visible solo para Contabilidad (dueña del dato de facturación).
  const mostrarFactura = profile?.area === 'contabilidad'
  // Visible solo para Comercial (dueña de Proforma/Orden de Compra).
  const mostrarDocsComercial = profile?.area === 'comercial'
  // Visible solo para Laboratorio (dueño de los certificados de calibración).
  const mostrarCertLab = profile?.area === 'laboratorio'

  // Gerencia no tiene un semáforo "propio" — supervisa las tres áreas, así
  // que en vez de mostrarle los tres a la vez (mismo conflicto visual que
  // ya corregimos), elige cuál quiere ver con un selector. Nunca se
  // combinan dos semáforos para la misma persona, tampoco para Gerencia.
  const necesitaFactura = mostrarFactura || (esGerencia && vistaGerencia === 'factura')
  const necesitaDocsComercial = mostrarDocsComercial || (esGerencia && vistaGerencia === 'docsComercial')
  const necesitaCertLab = mostrarCertLab || (esGerencia && vistaGerencia === 'certLab')

  useEffect(() => {
    if (!necesitaFactura) return
    async function cargarFacturas() {
      const { data, error } = await supabase.from('cobranza').select('ot_number, estado')
      if (error) {
        console.error('No se pudo cargar estado de facturación:', error)
        return
      }
      const mapa = {}
      for (const c of data || []) {
        mapa[c.ot_number] = c.estado === 'cobrado' ? 'cobrado' : 'pendiente'
      }
      setFacturaPorOT(mapa)
    }
    cargarFacturas()
  }, [necesitaFactura])

  // Cruza `documentos` (todas las áreas) buscando qué OT ya tienen Proforma
  // y/o Orden de Compra / Cotización subidas.
  useEffect(() => {
    if (!necesitaDocsComercial) return
    async function cargarDocsComercial() {
      const tipos = ['proforma', 'orden de compra', 'cotización']
      const filtro = tipos.map((t) => `tipo_documento.ilike.${t}`).join(',')
      const { data, error } = await supabase.from('documentos').select('ot_number, tipo_documento').or(filtro)
      if (error) {
        console.error('No se pudo cargar estado de documentos comerciales:', error)
        return
      }
      const acumulado = {}
      for (const row of data || []) {
        const tipoLower = (row.tipo_documento || '').toLowerCase()
        if (!acumulado[row.ot_number]) acumulado[row.ot_number] = { proforma: false, oc: false }
        if (tipoLower === 'proforma') acumulado[row.ot_number].proforma = true
        if (tipoLower === 'orden de compra' || tipoLower === 'cotización') acumulado[row.ot_number].oc = true
      }
      const mapa = {}
      for (const [ot, v] of Object.entries(acumulado)) {
        mapa[ot] = v.proforma && v.oc ? 'completo' : (v.proforma || v.oc) ? 'parcial' : 'sin_documentos'
      }
      setDocsComercialPorOT(mapa)
    }
    cargarDocsComercial()
  }, [necesitaDocsComercial])

  // Cruza `documentos` buscando qué OT ya tienen al menos un Certificado de
  // calibración subido (cualquier área, aunque normalmente es Laboratorio).
  useEffect(() => {
    if (!necesitaCertLab) return
    async function cargarCertLab() {
      const { data, error } = await supabase.from('documentos').select('ot_number, tipo_documento').ilike('tipo_documento', 'certificado')
      if (error) {
        console.error('No se pudo cargar estado de certificados:', error)
        return
      }
      const mapa = {}
      for (const row of data || []) {
        mapa[row.ot_number] = 'con_certificado'
      }
      setCertLabPorOT(mapa)
    }
    cargarCertLab()
  }, [necesitaCertLab])

  // ── Semáforo activo para esta persona (uno solo, nunca ambos) ──────────
  const overlay = mostrarFactura
    ? {
        activo: true,
        cfg: ESTADO_FACTURA_CFG,
        estadoPorOT: facturaPorOT,
        defaultEstado: 'sin_factura',
        leyenda: 'En esta vista el color indica solo el estado de la factura — no la prioridad del servicio.',
      }
    : mostrarDocsComercial
    ? {
        activo: true,
        cfg: ESTADO_DOCS_COMERCIAL_CFG,
        estadoPorOT: docsComercialPorOT,
        defaultEstado: 'sin_documentos',
        leyenda: 'En esta vista el color indica solo si faltan Proforma/Orden de Compra — no la prioridad del servicio.',
      }
    : mostrarCertLab
    ? {
        activo: true,
        cfg: ESTADO_CERT_LAB_CFG,
        estadoPorOT: certLabPorOT,
        defaultEstado: 'sin_certificado',
        leyenda: 'En esta vista el color indica solo si falta el certificado de calibración — no la prioridad del servicio.',
      }
    : esGerencia && vistaGerencia === 'factura'
    ? {
        activo: true,
        cfg: ESTADO_FACTURA_CFG,
        estadoPorOT: facturaPorOT,
        defaultEstado: 'sin_factura',
        leyenda: 'Viendo el semáforo de Contabilidad — no la prioridad del servicio.',
      }
    : esGerencia && vistaGerencia === 'docsComercial'
    ? {
        activo: true,
        cfg: ESTADO_DOCS_COMERCIAL_CFG,
        estadoPorOT: docsComercialPorOT,
        defaultEstado: 'sin_documentos',
        leyenda: 'Viendo el semáforo de Comercial — no la prioridad del servicio.',
      }
    : esGerencia && vistaGerencia === 'certLab'
    ? {
        activo: true,
        cfg: ESTADO_CERT_LAB_CFG,
        estadoPorOT: certLabPorOT,
        defaultEstado: 'sin_certificado',
        leyenda: 'Viendo el semáforo de Laboratorio — no la prioridad del servicio.',
      }
    : { activo: false }

  const año = mesActual.getFullYear()
  const mes = mesActual.getMonth()

  // Servicios agrupados por día del mes visible (clave: 'YYYY-MM-DD')
  const porDia = useMemo(() => {
    const map = {}
    services.forEach((s) => {
      if (!s.due_date) return
      const key = s.due_date.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(s)
    })
    return map
  }, [services])

  // OT atrasadas: fecha ya pasada y no concluidas — para la lista de "atención requerida"
  const atrasadas = useMemo(() => {
    return services
      .filter((s) => s.due_date && s.status !== 'concluido' && diasDeAtraso(s.due_date) > 0)
      .sort((a, b) => diasDeAtraso(b.due_date) - diasDeAtraso(a.due_date))
  }, [services])

  // Armar la cuadrícula del mes (empezando en lunes)
  const primerDiaMes = new Date(año, mes, 1)
  const ultimoDiaMes = new Date(año, mes + 1, 0)
  const offsetInicio = (primerDiaMes.getDay() + 6) % 7 // 0 = lunes
  const totalDias = ultimoDiaMes.getDate()

  const celdas = []
  for (let i = 0; i < offsetInicio; i++) celdas.push(null)
  for (let d = 1; d <= totalDias; d++) celdas.push(d)

  function claveDelDia(d) {
    const mm = String(mes + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    return `${año}-${mm}-${dd}`
  }

  function esHoy(d) {
    const hoy = new Date()
    return d === hoy.getDate() && mes === hoy.getMonth() && año === hoy.getFullYear()
  }

  function abrirDia(d, items) {
    if (items.length === 0) return
    const fechaLegible = new Date(año, mes, d).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
    setDiaSeleccionado({ fecha: fechaLegible, items })
  }

  // Al seleccionar una OT desde el buscador: si tiene fecha, saltamos al
  // mes correspondiente y abrimos ese día; si no tiene fecha, vamos
  // directo al detalle de la OT.
  function seleccionarDesdeBuscador(servicio) {
    if (!servicio.due_date) {
      navigate(`/ot/${servicio.ot_number}`)
      return
    }
    const fecha = new Date(servicio.due_date)
    setMesActual(new Date(fecha.getFullYear(), fecha.getMonth(), 1))
    const clave = servicio.due_date.slice(0, 10)
    const itemsDelDia = services.filter((s) => s.due_date?.slice(0, 10) === clave)
    const fechaLegible = fecha.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
    setDiaSeleccionado({ fecha: fechaLegible, items: itemsDelDia })
  }

  return (
    <div>
      <BuscadorOT services={services} onSeleccionar={seleccionarDesdeBuscador} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button className="btn btn-secondary" onClick={() => setMesActual(new Date(año, mes - 1, 1))}>&larr;</button>
        <strong style={{ fontSize: 16 }}>{MESES[mes]} {año}</strong>
        <button className="btn btn-secondary" onClick={() => setMesActual(new Date(año, mes + 1, 1))}>&rarr;</button>
      </div>

      {esGerencia && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Semáforo a mostrar:</span>
          {[
            ['ninguno', 'Ninguno (solo prioridad)'],
            ['factura', '💰 Contabilidad'],
            ['docsComercial', '📋 Comercial'],
            ['certLab', '🔬 Laboratorio'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={vistaGerencia === k ? 'btn' : 'btn btn-secondary'}
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => setVistaGerencia(k)}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {overlay.activo && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            {Object.keys(overlay.cfg).map((k) => {
              const cfg = overlay.cfg[k]
              return (
                <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: 5, background: cfg.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 900, color: '#0a0e14', flexShrink: 0,
                  }}>
                    {cfg.icono}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{cfg.titulo}</span>
                </span>
              )
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {overlay.leyenda}
          </p>
        </div>
      )}

      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, marginBottom: 6 }}>
          {DIAS_SEMANA.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {celdas.map((d, i) => {
            if (d === null) return <div key={i} />
            const clave = claveDelDia(d)
            const items = porDia[clave] || []
            const hayAtraso = items.some((s) => s.status !== 'concluido' && diasDeAtraso(s.due_date) > 0)
            const MOSTRAR = 3

            return (
              <div
                key={i}
                onClick={() => abrirDia(d, items)}
                style={{
                  minHeight: 70,
                  borderRadius: 8,
                  padding: 6,
                  background: esHoy(d) ? 'rgba(45,212,191,0.08)' : 'rgba(255,255,255,0.02)',
                  border: hayAtraso ? '1px solid rgba(248,113,113,0.5)' : '1px solid var(--border)',
                  cursor: items.length > 0 ? 'pointer' : 'default',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: esHoy(d) ? 'var(--ocean-accent)' : 'var(--text-muted)', fontWeight: esHoy(d) ? 700 : 400 }}>
                    {d}
                  </span>
                  {items.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '0 6px' }}>
                      {items.length}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                  {items.slice(0, MOSTRAR).map((s) => (
                    <div
                      key={s.id}
                      title={`${s.ot_number} — ${s.client}`}
                      style={{
                        fontSize: 10,
                        padding: '2px 4px 2px 6px',
                        borderRadius: 4,
                        overflow: 'hidden',
                        lineHeight: 1.2,
                        ...estiloItemCelda(s, overlay),
                      }}
                    >
                      <div style={{ fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {s.ot_number}
                      </div>
                      <div style={{ fontSize: 9, opacity: 0.85, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {s.client}
                      </div>
                    </div>
                  ))}
                  {items.length > MOSTRAR && (
                    <div style={{ fontSize: 10, color: 'var(--ocean-accent)', fontWeight: 600 }}>
                      +{items.length - MOSTRAR} más — ver todo
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>
          Atención requerida — {atrasadas.length} servicio{atrasadas.length !== 1 ? 's' : ''} atrasado{atrasadas.length !== 1 ? 's' : ''}
        </h4>
        {atrasadas.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No hay servicios atrasados. Buen trabajo.</p>
        )}
        {atrasadas.map((s) => {
          const estado = overlay.activo ? (overlay.estadoPorOT[s.ot_number] || overlay.defaultEstado) : null
          return (
            <div
              key={s.id}
              className="doc-item"
              onClick={() => navigate(`/ot/${s.ot_number}`)}
              style={{
                cursor: 'pointer',
                ...estiloFila(overlay, estado),
              }}
            >
              <div>
                <strong>{s.ot_number}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{s.client}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {overlay.activo && <ChipEstado estado={estado} cfg={overlay.cfg} />}
                <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 13 }}>
                  {diasDeAtraso(s.due_date)} día{diasDeAtraso(s.due_date) !== 1 ? 's' : ''} de retraso
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {diaSeleccionado && (
        <DiaModal
          fecha={diaSeleccionado.fecha}
          items={diaSeleccionado.items}
          onClose={() => setDiaSeleccionado(null)}
          navigate={navigate}
          overlay={overlay}
        />
      )}
    </div>
  )
}