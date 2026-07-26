import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Dashboard({ profile, onLogout }) {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    async function loadServices() {
      const { data, error } = await supabase
        .from('services')
        .select('id, ot_number, client, service_type, status, priority, due_date')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!error) setServices(data || [])
      setLoading(false)
    }
    loadServices()
  }, [])

  const filtered = services.filter((s) =>
    (s.ot_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.client || '').toLowerCase().includes(search.toLowerCase())
  )

  function badgeClass(priority) {
    if (priority === 'alta') return 'badge badge-alta'
    if (priority === 'media') return 'badge badge-media'
    return 'badge badge-normal'
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

      <div className="card" style={{ padding: 0 }}>
        {loading && <p style={{ padding: 20 }}>Cargando...</p>}
        {!loading && filtered.length === 0 && <p style={{ padding: 20 }}>No hay servicios registrados.</p>}
        {filtered.map((s) => (
          <div key={s.id} className="ot-row" onClick={() => navigate(`/ot/${s.ot_number}`)}>
            <div>
              <strong>{s.ot_number}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.client}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={badgeClass(s.priority)}>{s.priority}</span>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
