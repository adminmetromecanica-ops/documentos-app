import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// Orden y etiquetas de los grupos de estado. Los que no coincidan con esta
// lista caen en un grupo "Otros" al final, así nuevos estados no rompen nada.
const ORDEN_ESTADOS = [
  { key: 'pendiente-cert', label: 'Pendiente de certificado' },
  { key: 'pendiente-fact', label: 'Pendiente de facturación' },
  { key: 'pendiente-faci', label: 'Pendiente de facturación' },
  { key: 'concluido', label: 'Concluido' },
]

const PRIORIDAD_ORDEN = { alta: 0, media: 1, normal: 2 }

export default function Dashboard({ profile, onLogout }) {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [colapsados, setColapsados] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    async function loadServices() {
      const { data, error } = await supabase
        .from('services')
        .select('id, ot_number, client, service_type, status, priority, due_date')
        .order('created_at', { ascending: false })
        .limit(300)
      if (!error) setServices(data || [])
      setLoading(false)
    }
    loadServices()
  }, [])

  const filtered = services.filter((s) =>
    (s.ot_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.client || '').toLowerCase().includes(search.toLowerCase())
  )

  // Agrupar por estado
  const grupos = {}
  filtered.forEach((s) => {
    const key = s.status || 'sin-estado'
    if (!grupos[key]) grupos[key] = []
    grupos[key].push(s)
  })

  // Ordenar cada grupo por fecha (día, mes, año) de forma ascendente.
  // Las OT sin fecha quedan al final del grupo.
  Object.values(grupos).forEach((lista) => {
    lista.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return new Date(a.due_date) - new Date(b.due_date)
    })
  })

  // Definir el orden de aparición de los grupos en pantalla
  const clavesConocidas = ORDEN_ESTADOS.map((e) => e.key)
  const clavesOtras = Object.keys(grupos).filter((k) => !clavesConocidas.includes(k))
  const ordenFinal = [...ORDEN_ESTADOS, ...clavesOtras.map((k) => ({ key: k, label: k }))]

  function badgeClass(priority) {
    if (priority === 'alta') return 'badge badge-alta'
    if (priority === 'media') return 'badge badge-media'
    return 'badge badge-normal'
  }

  function toggleGrupo(key) {
    setColapsados((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="container">
      <div className="top-bar">
        <div>
          <h2 style={{ margin: 0 }}>Órdenes de Trabajo</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Área: <strong style={{ color: 'var(--ocean-accent)' }}>{profile?.area || '—'}</strong>
          </p>
        </div>
        <button className="btn btn-secondary" onClick={onLogout}>Salir</button>
      </div>

      <input
        placeholder="Buscar por OT o cliente..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && <p>Cargando...</p>}
      {!loading && filtered.length === 0 && <p>No hay servicios registrados.</p>}

      {!loading && ordenFinal.map(({ key, label }) => {
        const lista = grupos[key]
        if (!lista || lista.length === 0) return null
        const colapsado = colapsados[key]

        return (
          <div key={key} className="card" style={{ padding: 0, marginBottom: 14 }}>
            <div
              onClick={() => toggleGrupo(key)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 18px',
                cursor: 'pointer',
                borderBottom: colapsado ? 'none' : '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{colapsado ? '▸' : '▾'}</span>
                <strong>{label}</strong>
              </div>
              <span
                style={{
                  background: 'rgba(45,212,191,0.15)',
                  color: 'var(--ocean-accent)',
                  borderRadius: 20,
                  padding: '2px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {lista.length}
              </span>
            </div>

            {!colapsado && lista.map((s) => (
              <div key={s.id} className="ot-row" onClick={() => navigate(`/ot/${s.ot_number}`)}>
                <div>
                  <strong>{s.ot_number}</strong>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.client}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={badgeClass(s.priority)}>{s.priority}</span>
                  {s.due_date && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {new Date(s.due_date).toLocaleDateString('es-PE')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
