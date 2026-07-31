import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Portal({ profile, onLogout }) {
  const [herramientas, setHerramientas] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const esGerencia = profile?.area === 'gerencia'

  useEffect(() => {
    async function cargar() {
      const { data, error } = await supabase
        .from('herramientas')
        .select('*')
        .order('orden', { ascending: true })
      if (!error) setHerramientas(data || [])
      setLoading(false)
    }
    cargar()
  }, [])

  function abrir(url) {
    if (url.startsWith('/')) navigate(url)
    else window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="container">
      <div className="top-bar">
        <div>
          <h2 style={{ margin: 0 }}>Central de trabajo</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Área: <strong style={{ color: 'var(--ocean-accent)' }}>{profile?.area || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {esGerencia && (
            <button className="btn btn-secondary" onClick={() => navigate('/admin/herramientas')}>
              Administrar herramientas
            </button>
          )}
          <button className="btn btn-secondary" onClick={onLogout}>Salir</button>
        </div>
      </div>

      {loading && <p>Cargando...</p>}

      {!loading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}>
          {herramientas.map((h) => (
            <div
              key={h.id}
              className="card"
              onClick={() => abrir(h.url)}
              style={{ textAlign: 'center', cursor: 'pointer', padding: '1.25rem 1rem' }}
            >
              <div style={{ fontSize: 28 }}>{h.icono}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>{h.nombre}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
