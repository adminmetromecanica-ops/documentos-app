import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const AREAS = ['laboratorio', 'contabilidad', 'comercial', 'logistica', 'gerencia']

export default function AdminHerramientas({ profile, onLogout }) {
  const [herramientas, setHerramientas] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ nombre: '', url: '', icono: '🔗', areas_visibles: [], orden: 10 })
  const navigate = useNavigate()

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const { data } = await supabase.from('herramientas').select('*').order('orden')
    setHerramientas(data || [])
    setLoading(false)
  }

  async function crear() {
    if (!form.nombre.trim() || !form.url.trim()) return
    await supabase.from('herramientas').insert(form)
    setForm({ nombre: '', url: '', icono: '🔗', areas_visibles: [], orden: 10 })
    cargar()
  }

  async function toggleActivo(h) {
    await supabase.from('herramientas').update({ activo: !h.activo }).eq('id', h.id)
    cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar esta herramienta?')) return
    await supabase.from('herramientas').delete().eq('id', id)
    cargar()
  }

  function toggleArea(area) {
    setForm((f) => ({
      ...f,
      areas_visibles: f.areas_visibles.includes(area)
        ? f.areas_visibles.filter((a) => a !== area)
        : [...f.areas_visibles, area],
    }))
  }

  if (profile?.area !== 'gerencia') return <div className="container">No autorizado.</div>

  return (
    <div className="container">
      <div className="top-bar">
        <a className="link-back" onClick={() => navigate('/')}>&larr; Volver al portal</a>
        <button className="btn btn-secondary" onClick={onLogout}>Salir</button>
      </div>

      <h2>Administrar herramientas</h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <h4 style={{ marginTop: 0 }}>Nueva herramienta</h4>
        <input placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input placeholder="URL (o /ruta interna)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input placeholder="Ícono (emoji)" value={form.icono} onChange={(e) => setForm({ ...form, icono: e.target.value })} style={{ width: 80 }} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '10px 0' }}>
          {AREAS.map((a) => (
            <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.areas_visibles.includes(a)} onChange={() => toggleArea(a)} style={{ width: 'auto' }} />
              {a}
            </label>
          ))}
        </div>
        <button className="btn" onClick={crear}>Crear</button>
      </div>

      {loading && <p>Cargando...</p>}
      {!loading && herramientas.map((h) => (
        <div key={h.id} className="ot-row">
          <div>
            <strong>{h.icono} {h.nombre}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.url}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Áreas: {h.areas_visibles.join(', ')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => toggleActivo(h)}>{h.activo ? 'Desactivar' : 'Activar'}</button>
            <button className="btn btn-secondary" onClick={() => eliminar(h.id)}>Eliminar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
