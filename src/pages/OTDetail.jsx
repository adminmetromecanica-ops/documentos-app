import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { AREAS_CONFIG, TODAS_LAS_AREAS } from '../lib/areasConfig'
import UploadForm from '../components/UploadForm'

const WEBHOOK_URL_DOCUMENTO = "https://panel.5-189-165-144.sslip.io/api-patrones/url-documento"

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

// Modal embebido: muestra el documento sin salir de la app, con Office Online
// para Word/Excel/PowerPoint, o directo (iframe/img) para PDF e imágenes.
function VisorDocumento({ titulo, url, extension, onClose }) {
  const esOffice = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes((extension || '').toLowerCase())
  const src = esOffice
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
    : url

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
          background: 'var(--panel-bg, #0f172a)', borderRadius: 12, width: '100%', maxWidth: 1100,
          height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</strong>
          <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={onClose}>✕ Cerrar</button>
        </div>
        <iframe
          src={src}
          title={titulo}
          style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
        />
      </div>
    </div>
  )
}

// Pastilla roja con el número de notificaciones no leídas. No se renderiza si count es 0.
function BadgeNoLeidos({ count }) {
  if (!count) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        marginLeft: 6,
        borderRadius: 999,
        background: 'var(--danger, #f87171)',
        color: '#1a0505',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function OTDetail({ profile }) {
  const { otNumber } = useParams()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [documentos, setDocumentos] = useState([])
  const [activeArea, setActiveArea] = useState(profile.area === 'gerencia' ? 'laboratorio' : profile.area)
  const [abriendoId, setAbriendoId] = useState(null)
  const [visor, setVisor] = useState(null) // { titulo, url, extension } | null
  const [noLeidosPorArea, setNoLeidosPorArea] = useState({}) // { laboratorio: 2, comercial: 0, ... }

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

    const docs = data || []

    // Cruzar subido_por (UUID) con profiles.full_name — sin depender de FK en Supabase
    const ids = [...new Set(docs.map((d) => d.subido_por).filter(Boolean))]
    let nombresPorId = {}
    if (ids.length > 0) {
      const { data: perfiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids)
      nombresPorId = Object.fromEntries((perfiles || []).map((p) => [p.id, p.full_name]))
    }

    setDocumentos(docs.map((d) => ({ ...d, _subido_por_nombre: nombresPorId[d.subido_por] || null })))
  }

  useEffect(() => {
    loadDocumentos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArea, otNumber])

  // Cuenta notificaciones no leídas por área, solo para las áreas visibles de este usuario
  async function loadNoLeidos() {
    if (!otNumber || areasVisibles.length === 0) return
    const { data, error } = await supabase
      .from('notificaciones')
      .select('area')
      .eq('ot_number', otNumber)
      .eq('leido', false)
      .in('area', areasVisibles)

    if (error) {
      console.error('No se pudo cargar notificaciones:', error)
      return
    }

    const conteo = {}
    for (const row of data || []) {
      conteo[row.area] = (conteo[row.area] || 0) + 1
    }
    setNoLeidosPorArea(conteo)
  }

  // Marca como leídas las notificaciones del área que se acaba de abrir
  async function marcarLeidoArea(area) {
    if (!noLeidosPorArea[area]) return // nada pendiente, evita updates innecesarios
    const { error } = await supabase
      .from('notificaciones')
      .update({ leido: true })
      .eq('ot_number', otNumber)
      .eq('area', area)
      .eq('leido', false)

    if (error) {
      console.error('No se pudo marcar como leído:', error)
      return
    }
    setNoLeidosPorArea((prev) => ({ ...prev, [area]: 0 }))
  }

  // Carga inicial de notificaciones + suscripción en vivo (Realtime) para esta OT
  useEffect(() => {
    loadNoLeidos()

    const channel = supabase
      .channel(`notificaciones-ot-${otNumber}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notificaciones', filter: `ot_number=eq.${otNumber}` },
        () => {
          loadNoLeidos()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otNumber])

  // Al cambiar de pestaña, marca como leídas las notificaciones del área que se abre
  useEffect(() => {
    marcarLeidoArea(activeArea)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArea, otNumber])

  function handleUploaded() {
    registrarAuditoria(profile.id, 'subir', otNumber, `Área: ${activeArea}`)
    loadDocumentos()
  }

  // Pide a n8n una URL firmada temporal de MinIO y abre el documento en el visor embebido.
  // El bucket es privado — nunca se expone una URL directa y permanente.
  async function verDocumento(doc) {
    if (!doc.ruta_minio) {
      alert('Este documento no tiene una ruta válida en MinIO.')
      return
    }
    setAbriendoId(doc.id)
    try {
      const resp = await fetch(WEBHOOK_URL_DOCUMENTO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta_minio: doc.ruta_minio }),
      })
      const data = await resp.json()
      if (data?.url) {
        registrarAuditoria(profile.id, 'ver_documento', otNumber, doc.nombre_archivo)
        const ext = (doc.nombre_archivo || '').split('.').pop().toLowerCase()
        setVisor({ titulo: doc.nombre_archivo, url: data.url, extension: ext })
      } else {
        alert('No se pudo generar el enlace del documento. Intenta de nuevo.')
      }
    } catch (e) {
      console.error('Error obteniendo URL del documento:', e)
      alert('Error al abrir el documento. Revisa tu conexión e intenta de nuevo.')
    }
    setAbriendoId(null)
  }

  // El Word original de la OT (adjuntado en MetroTrack) es el documento "madre":
  // todas las áreas trabajan a partir de él, así que se muestra sin restricción
  // de visibilidad cruzada — a diferencia de los documentos internos por área.
  function verDocumentoOT() {
    if (!service?.ot_file_url) return
    registrarAuditoria(profile.id, 'ver_documento_ot', otNumber, 'Word original de la OT')
    setVisor({ titulo: `${otNumber} — Documento original`, url: service.ot_file_url, extension: 'docx' })
  }

  const configArea = AREAS_CONFIG[activeArea]

  return (
    <div className="container">
      <a className="link-back" onClick={() => navigate(-1)}>&larr; Volver a la lista</a>

      <div className="top-bar" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{otNumber}</h2>
          {service?.ot_file_url && (
            <button
              className="btn btn-secondary"
              title="Ver documento Word original de la OT (visible para todas las áreas)"
              onClick={verDocumentoOT}
              style={{ padding: '4px 10px', fontSize: 13 }}
            >
              👁 Ver OT
            </button>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '4px 0 0' }}>
          {service?.client || 'Cargando...'} — {service?.status}
        </p>
      </div>

      {areasVisibles.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {areasVisibles.map((a) => (
            <button
              key={a}
              className={activeArea === a ? 'btn' : 'btn btn-secondary'}
              onClick={() => setActiveArea(a)}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              {AREAS_CONFIG[a].label}
              {!esGerencia && a !== profile.area && ' 👁'}
              <BadgeNoLeidos count={noLeidosPorArea[a]} />
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
          <div key={d.id} className="doc-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nombre_archivo}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {d._subido_por_nombre ? `Subido por ${d._subido_por_nombre}` : 'Subido por —'}
                {' · '}
                {new Date(d.created_at).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 12px', fontSize: 12, flexShrink: 0 }}
              disabled={abriendoId === d.id}
              onClick={() => verDocumento(d)}
            >
              {abriendoId === d.id ? '⏳ Abriendo...' : '👁 Ver'}
            </button>
          </div>
        ))}
      </div>

      {visor && (
        <VisorDocumento
          titulo={visor.titulo}
          url={visor.url}
          extension={visor.extension}
          onClose={() => setVisor(null)}
        />
      )}
    </div>
  )
}