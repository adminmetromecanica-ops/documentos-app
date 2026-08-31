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

// ── Indicador de estado de facturación — solo visible para Contabilidad/Gerencia ──
// Antes competía con el color de prioridad de la OT (mismo esquema rojo/
// amarillo/gris para dos cosas distintas → confuso, especialmente con baja
// visión). Ahora, cuando esta vista está activa, el color de PRIORIDAD deja
// de usarse: todo el color de la tarjeta pasa a representar únicamente el
// estado de la factura, y el texto queda en un tono neutro. Un solo
// semáforo, un solo significado.
const ESTADO_FACTURA_CFG = {
  cobrado: { color: '#4ade80', titulo: 'Factura cobrada', texto: 'COBRADA', icono: '✓' },
  pendiente: { color: '#facc15', titulo: 'Factura registrada — pendiente de cobro', texto: 'FACTURADA', icono: '$' },
  sin_factura: { color: '#f87171', titulo: 'Sin factura registrada', texto: 'SIN FACTURA', icono: '!' },
}

// Chip grande con ícono + texto — usado donde hay espacio (modal, atrasadas)
function ChipFactura({ estado }) {
  const cfg = ESTADO_FACTURA_CFG[estado]
  if (!cfg) return null
  return (
    <span
      title={cfg.titulo}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.5,
        color: '#0a0e14',
        background: cfg.color,
        borderRadius: 6,
        padding: '3px 9px',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{cfg.icono}</span>
      {cfg.texto}
    </span>
  )
}

// Estilo de la tarjeta de una OT dentro de una celda del calendario.
// - Vista normal (mostrarFactura=false): color por prioridad, como siempre.
// - Vista Contabilidad/Gerencia (mostrarFactura=true): color SOLO por estado
//   de factura — fondo tintado + franja lateral del mismo color, texto
//   neutro. Se evita mezclar dos semáforos con la misma paleta.
function estiloItemCelda(s, mostrarFactura, facturaPorOT) {
  if (mostrarFactura) {
    const estado = facturaPorOT[s.ot_number] || 'sin_factura'
    const cfg = ESTADO_FACTURA_CFG[estado]
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
function estiloFila(mostrarFactura, estado) {
  if (!mostrarFactura) return {}
  const cfg = ESTADO_FACTURA_CFG[estado]
  return {
    borderLeft: `6px solid ${cfg.color}`,
    background: `${cfg.color}14`,
  }
}

// Modal: muestra TODAS las OT de un día, sin límite — pensado para
// días con carga alta (10, 15, 30+ servicios).
function DiaModal({ fecha, items, onClose, navigate, mostrarFactura, facturaPorOT }) {
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
            const estadoFactura = facturaPorOT[s.ot_number] || 'sin_factura'
            return (
              <div
                key={s.id}
                onClick={() => navigate(`/ot/${s.ot_number}`)}
                className="doc-item"
                style={{
                  cursor: 'pointer',
                  padding: '10px 12px',
                  ...estiloFila(mostrarFactura, estadoFactura),
                }}
              >
                <div>
                  <strong>{s.ot_number}</strong>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.client}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {mostrarFactura ? (
                    <ChipFactura estado={estadoFactura} />
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
  const navigate = useNavigate()

  // Visible para Contabilidad (dueña del dato) y Gerencia/admin@ (supervisión).
  const mostrarFactura = ['contabilidad', 'gerencia'].includes(profile?.area)

  // Solo Contabilidad/Gerencia necesitan este cruce — se evita la consulta
  // para el resto de áreas, que no ven el indicador.
  useEffect(() => {
    if (!mostrarFactura) return
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
  }, [mostrarFactura])

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

      {mostrarFactura && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            {['cobrado', 'pendiente', 'sin_factura'].map((k) => {
              const cfg = ESTADO_FACTURA_CFG[k]
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
            En esta vista el color indica solo el estado de la factura — no la prioridad del servicio.
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
                        ...estiloItemCelda(s, mostrarFactura, facturaPorOT),
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
          const estadoFactura = facturaPorOT[s.ot_number] || 'sin_factura'
          return (
            <div
              key={s.id}
              className="doc-item"
              onClick={() => navigate(`/ot/${s.ot_number}`)}
              style={{
                cursor: 'pointer',
                ...estiloFila(mostrarFactura, estadoFactura),
              }}
            >
              <div>
                <strong>{s.ot_number}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{s.client}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {mostrarFactura && <ChipFactura estado={estadoFactura} />}
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
          mostrarFactura={mostrarFactura}
          facturaPorOT={facturaPorOT}
        />
      )}
    </div>
  )
}