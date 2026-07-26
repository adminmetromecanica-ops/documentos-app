import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { AREAS_CONFIG, TODAS_LAS_AREAS } from '../lib/areasConfig'
import UploadForm from '../components/UploadForm'

export default function OTDetail({ profile }) {
  const { otNumber } = useParams()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [documentos, setDocumentos] = useState([])
  const [activeArea, setActiveArea] = useState(profile.area === 'gerencia' ? 'laboratorio' : profile.area)

  const esGerencia = profile.area === 'gerencia'
  const areasVisibles = esGerencia ? TODAS_LAS_AREAS : [profile.area]

  useEffect(() => {
    async function loadService() {
      const { data } = await supabase
        .from('services')
        .select('*')
        .eq('ot_number', otNumber)
        .maybeSingle()
      setService(data)
    }
    loadService()
  }, [otNumber])

  async function loadDocumentos() {
    let query = supabase.from('documentos').select('*').eq('ot_number', otNumber)
    if (!esGerencia) query = query.eq('area', profile.area)
    else query = query.eq('area', activeArea)
    const { data } = await query.order('created_at', { ascending: false })
    setDocumentos(data || [])
  }

  useEffect(() => {
    loadDocumentos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArea, otNumber])

  const configArea = AREAS_CONFIG[activeArea]

  return (
    <div className="container">
      <a className="link-back" onClick={() => navigate('/')}>&larr; Volver a la lista</a>

      <div className="top-bar" style={{ marginTop: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>{otNumber}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '4px 0 0' }}>
            {service?.client || 'Cargando...'} — {service?.status}
          </p>
        </div>
      </div>

      {esGerencia && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {areasVisibles.map((a) => (
            <button
              key={a}
              className={activeArea === a ? 'btn' : 'btn btn-secondary'}
              onClick={() => setActiveArea(a)}
            >
              {AREAS_CONFIG[a].label}
            </button>
          ))}
        </div>
      )}

      <h3>{configArea.label}</h3>

      <UploadForm
        otNumber={otNumber}
        area={activeArea}
        tipos={configArea.tipos}
        userId={profile.id}
        onUploaded={loadDocumentos}
      />

      <div className="card">
        <h4 style={{ marginTop: 0 }}>Documentos subidos</h4>
        {documentos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Aún no hay documentos en esta área.</p>}
        {documentos.map((d) => (
          <div key={d.id} className="doc-item">
            <span>{d.nombre_archivo}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {new Date(d.created_at).toLocaleDateString('es-PE')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
