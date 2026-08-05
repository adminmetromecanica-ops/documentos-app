import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const WEBHOOK_BUSCAR = 'https://panel.5-189-165-144.sslip.io/api-patrones/buscar-documentos'

// Misma visibilidad cruzada que ya usa OTDetail.jsx — el buscador nunca
// debe mostrar más de lo que la persona vería normalmente en la app.
const VISIBILIDAD_CRUZADA = {
  laboratorio: ['logistica'],
  logistica: ['laboratorio'],
  comercial: ['laboratorio', 'logistica'],
  contabilidad: ['laboratorio', 'logistica', 'comercial'],
}

function limpiarHtml(texto) {
  // El resaltado de Elasticsearch viene como texto con <em>...</em>.
  // Lo mostramos tal cual con dangerouslySetInnerHTML, pero primero
  // nos aseguramos de que no traiga nada más que esas etiquetas simples.
  return { __html: texto.replace(/</g, (m, i, s) => (s.slice(i, i + 4) === '<em>' || s.slice(i, i + 5) === '</em>' ? m : '&lt;')) }
}

export default function Buscador({ profile, onLogout }) {
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [yaBusco, setYaBusco] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const esGerencia = profile?.area === 'gerencia'
  const areasPermitidas = esGerencia
    ? null // null = sin restricción, el backend no filtra
    : [profile.area, ...(VISIBILIDAD_CRUZADA[profile.area] || [])]

  async function handleBuscar(e) {
    e.preventDefault()
    if (!query.trim()) return

    setBuscando(true)
    setError('')
    setYaBusco(true)

    try {
      const resp = await fetch(WEBHOOK_BUSCAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), area: profile.area }),
      })

      if (!resp.ok) {
        setError('No se pudo completar la búsqueda. Intenta de nuevo.')
        setResultados([])
        setBuscando(false)
        return
      }

      const data = await resp.json()
      let hits = data?.hits?.hits || []

      // Filtro de visibilidad cruzada, aplicado en el frontend como
      // segunda capa (el backend hoy no filtra por área todavía).
      if (areasPermitidas) {
        hits = hits.filter((h) => areasPermitidas.includes(h._source.area))
      }

      setResultados(hits)
    } catch (e) {
      setError('Error de conexión con el buscador.')
      setResultados([])
    }

    setBuscando(false)
  }

  return (
    <div className="container">
      <div className="top-bar">
        <div>
          <a className="link-back" onClick={() => navigate('/')}>&larr; Volver al portal</a>
          <h2 style={{ margin: '8px 0 0' }}>Buscar en documentos</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Busca por contenido dentro de certificados, actas y fichas de OT.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={onLogout}>Salir</button>
      </div>

      <form onSubmit={handleBuscar} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Ej: nombre de cliente, código de patrón, número de OT..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit" disabled={buscando}>
          {buscando ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {error && <p className="error-msg">{error}</p>}

      {yaBusco && !buscando && resultados.length === 0 && !error && (
        <p style={{ color: 'var(--text-muted)' }}>No se encontraron documentos que coincidan con tu búsqueda.</p>
      )}

      {resultados.map((r) => {
        const { ot_number, area, nombre_archivo } = r._source
        const fragmento = r.highlight?.contenido?.[0]

        return (
          <div
            key={r._id}
            className="card"
            style={{ marginBottom: 12, cursor: ot_number !== 'SIN-OT' ? 'pointer' : 'default' }}
            onClick={() => ot_number !== 'SIN-OT' && navigate(`/ot/${ot_number}`)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong>{nombre_archivo}</strong>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  {ot_number === 'SIN-OT' ? 'Sin OT asociada' : ot_number} · {area}
                </div>
              </div>
            </div>
            {fragmento && (
              <p
                style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}
                dangerouslySetInnerHTML={limpiarHtml(fragmento)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
