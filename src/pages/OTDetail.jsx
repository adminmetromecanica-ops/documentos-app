import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { AREAS_CONFIG, TODAS_LAS_AREAS } from '../lib/areasConfig'
import UploadForm from '../components/UploadForm'

// Visibilidad cruzada de solo lectura (igual que las políticas de MinIO/RLS)
const VISIBILIDAD_CRUZADA = {
  laboratorio: ['logistica'],
  logistica: ['laboratorio'],
  comercial: ['laboratorio', 'logistica'],
  contabilidad: ['laboratorio', 'logistica', 'comercial'],
}

// Registra un evento en el log de auditoría. Falla en silencio: la
// auditoría nunca debe romper la experiencia de uso de la app.
async function registrarAuditoria(usuarioId, accion, otNumber, detalle) {
  try {
    await supabase.from('log_auditoria').insert({
      usuario_id: usuarioId,
      accion,
      ot_number: otNumber,
      detalle,
    })
  } catch (e) {
    console.error('No se pudo registrar auditoría:', e)
  }
}

export default function OTDetail({ profile }) {
  const { otNumber } = useParams()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [documentos, setDocumentos] = useState([])
  const [activeArea, setActiveArea] = useState(profile.area === 'gerencia' ? 'laboratorio' : profile.area)

  const esGerencia = profile.area === 'gerencia'

  // Áreas que este usuario puede ver (propia + las de solo lectura permitidas)
  const areasVisibles = esGerencia
    ? TODAS_LAS_AREAS
    : [profile.area, ...(VISIBILIDAD_CRUZADA[profile.area] || [])]

  // Es la propia área del usuario (donde sí puede subir), o gerencia que puede subir a cualquiera
  const puedeSubir = esGerencia || activeArea === profile.area

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

  // Registrar en el log de auditoría cada vez que se abre esta OT
  useEffect(() => {
    if (!profile?.id || !otNumber) return
    registrarAuditoria(profile.id, 'ver', otNumber, `Área vista: ${activeArea}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otNumber, activeArea, profile?.id])

  async function loadDocumentos() {
    // La política RLS ya decide qué puede leer cada área — el frontend solo pide lo que el usuario está viendo
    const { data } = await supabase
      .from('documentos')
      .select('*')
      .eq('ot_number', otNumber)
      .eq('area', activeArea)
      .order('created_at', { ascending: false })
    setDocumentos(data || [])
  }

  useEffect(() => {
    loadDocumentos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArea, otNumber])

  function handleUploaded() {
    registrarAuditoria(profile.id, 'subir', otNumber, `Área: ${activeArea}`)
    loadDocumentos()
  }

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

      {areasVisibles.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {areasVisibles.map((a) => (
            <button
              key={a}
              className={activeArea === a ? 'btn' : 'btn btn-secondary'}
              onClick={() => setActiveArea(a)}
            >
              {AREAS_CONFIG[a].label}
              {!esGerencia && a !== profile.area && ' 👁'}
            </button>
          ))}
        </div>
      )}

      <h3>{configArea.label}</h3>

      {puedeSubir ? (
        <UploadForm
          otNumber={otNumber}
          area={activeArea}
          tipos={configArea.tipos}
          userId={profile.id}
          onUploaded={handleUploaded}
        />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
          Solo lectura — esta área no te pertenece.
        </p>
      )}

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
