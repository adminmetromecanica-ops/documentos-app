import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

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

export default function CalendarView({ services }) {
  const [mesActual, setMesActual] = useState(new Date())
  const navigate = useNavigate()

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button className="btn btn-secondary" onClick={() => setMesActual(new Date(año, mes - 1, 1))}>&larr;</button>
        <strong style={{ fontSize: 16 }}>{MESES[mes]} {año}</strong>
        <button className="btn btn-secondary" onClick={() => setMesActual(new Date(año, mes + 1, 1))}>&rarr;</button>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
          {DIAS_SEMANA.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {celdas.map((d, i) => {
            if (d === null) return <div key={i} />
            const clave = claveDelDia(d)
            const items = porDia[clave] || []
            const hayAtraso = items.some((s) => s.status !== 'concluido' && diasDeAtraso(s.due_date) > 0)

            return (
              <div
                key={i}
                style={{
                  minHeight: 70,
                  borderRadius: 8,
                  padding: 6,
                  background: esHoy(d) ? 'rgba(45,212,191,0.08)' : 'rgba(255,255,255,0.02)',
                  border: hayAtraso ? '1px solid rgba(248,113,113,0.5)' : '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: 12, color: esHoy(d) ? 'var(--ocean-accent)' : 'var(--text-muted)', fontWeight: esHoy(d) ? 700 : 400 }}>
                  {d}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                  {items.slice(0, 3).map((s) => (
                    <div
                      key={s.id}
                      onClick={() => navigate(`/ot/${s.ot_number}`)}
                      title={`${s.ot_number} — ${s.client}`}
                      style={{
                        fontSize: 10,
                        padding: '2px 4px',
                        borderRadius: 4,
                        background: colorPrioridad(s.priority) + '22',
                        color: colorPrioridad(s.priority),
                        cursor: 'pointer',
                        overflow: 'hidden',
                        lineHeight: 1.2,
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
                  {items.length > 3 && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{items.length - 3} más</div>
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
        {atrasadas.map((s) => (
          <div key={s.id} className="doc-item" onClick={() => navigate(`/ot/${s.ot_number}`)} style={{ cursor: 'pointer' }}>
            <div>
              <strong>{s.ot_number}</strong>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{s.client}</span>
            </div>
            <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 13 }}>
              {diasDeAtraso(s.due_date)} día{diasDeAtraso(s.due_date) !== 1 ? 's' : ''} de retraso
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}