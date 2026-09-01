import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// ── Acceso ──────────────────────────────────────────────────────────────
// Por ahora solo Gerencia/admin@ (área 'gerencia'). Cuando exista un área
// de Calidad separada, basta con agregarla a este array — nada más del
// archivo depende de esta lista.
const AREAS_PERMITIDAS = ['gerencia']
const AREAS_EDITAN = ['gerencia']

const WEBHOOK_VER_DOCUMENTO_REDIRECT = "https://panel.5-189-165-144.sslip.io/api-patrones/ver-documento"

function construirEnlaceDocumento(rutaMinio) {
  return `${WEBHOOK_VER_DOCUMENTO_REDIRECT}?ruta=${encodeURIComponent(rutaMinio)}`
}

function normalizarTelefonoWhatsApp(telefono) {
  if (!telefono) return null
  const soloDigitos = telefono.replace(/[^\d]/g, '')
  if (!soloDigitos) return null
  if (soloDigitos.length === 9) return `51${soloDigitos}`
  return soloDigitos
}

function extraerTelefonoDeContacto(contactoTexto) {
  if (!contactoTexto) return ''
  const match = contactoTexto.match(/(\+?\d[\d\s-]{7,}\d)/)
  if (!match) return ''
  return match[1].replace(/[\s-]/g, '')
}

// Compositor web de Gmail — sin parámetro de cuenta fija, ya que este panel
// hoy es de uso interno/admin sin un correo dedicado de Calidad todavía.
// Si más adelante quieren un remitente fijo (como contabilidad@ para
// facturas), se agrega igual que allá con un solo parámetro authuser.
function construirLinkCorreo(destinatario, asunto, cuerpo) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: destinatario, su: asunto, body: cuerpo })
  return `https://mail.google.com/mail/?${params.toString()}`
}

function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function hoyISO() {
  return new Date().toISOString().split('T')[0]
}

function mesActualValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Extrae la cantidad de equipos de una OT desde services.ingresos ──────
// La columna ya llega como array (jsonb) desde Supabase — sin necesidad de
// JSON.parse, igual que en el resto de la app (ver EquiposIngresadosCard).
function contarEquipos(ingresos) {
  return Array.isArray(ingresos) ? ingresos.length : 0
}

// ── Semáforo de completitud (Certificado + Trazabilidad vs. equipos) ────
const ESTADO_CFG = {
  completo: { color: '#4c8a63', titulo: 'Certificados y trazabilidades completos', texto: 'COMPLETO' },
  parcial: { color: '#a97a2e', titulo: 'Faltan certificados o trazabilidades de algunos equipos', texto: 'PARCIAL' },
  sin_documentos: { color: '#c65b3a', titulo: 'Sin certificados ni trazabilidades subidas', texto: 'SIN DOCS' },
  sin_equipos: { color: '#7a6f5d', titulo: 'Esta OT no tiene equipos registrados en Ingresos', texto: 'SIN EQUIPOS' },
}

function calcularEstado(equipos, certificados, trazabilidades) {
  if (equipos === 0) return 'sin_equipos'
  if (certificados === 0 && trazabilidades === 0) return 'sin_documentos'
  if (certificados >= equipos && trazabilidades >= equipos) return 'completo'
  return 'parcial'
}

function armarMensajeRecordatorio(ot, cliente, equipos, certificados, trazabilidades) {
  return [
    `Estimados ${cliente || 'señores'},`,
    '',
    `Por medio del presente, MetroMecánica Ingeniería y Metrología S.A.C. les informa el estado de los certificados de calibración de la orden de trabajo ${ot}:`,
    '',
    `• Equipos ingresados: ${equipos}`,
    `• Certificados emitidos: ${certificados} de ${equipos}`,
    `• Trazabilidades emitidas: ${trazabilidades} de ${equipos}`,
    '',
    'Adjuntamos los enlaces de los documentos disponibles a la fecha.',
    '',
    'Saludos cordiales,',
    'MetroMecánica Ingeniería y Metrología S.A.C.',
    'RUC: 20605421696',
  ].join('\n')
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || 'var(--ocean-accent)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Badge({ estado }) {
  const cfg = ESTADO_CFG[estado]
  return (
    <span
      title={cfg.titulo}
      style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: `${cfg.color}22`, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}
    >
      {cfg.texto}
    </span>
  )
}

// ── Modal de recordatorio — mismo patrón que Seguimiento de Facturas ────
function ModalRecordatorio({ datos, onClose, onCambiarMensaje }) {
  const { ot, correo, mensaje, cargandoDocs, documentos } = datos
  const linkGmail = construirLinkCorreo(correo, `Certificados de calibración — OT ${ot.ot_number}`, mensaje)

  function copiarMensaje() {
    navigator.clipboard.writeText(mensaje)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: '100%', maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}
      >
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 16 }}>🔬 Certificados — OT {ot.ot_number}</strong>
          <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onClose}>✕ Cerrar</button>
        </div>

        <div style={{ padding: '20px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }}>Para</label>
            <input value={correo} readOnly style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }}>Mensaje (editable)</label>
            <textarea
              value={mensaje}
              onChange={(e) => onCambiarMensaje(e.target.value)}
              rows={12}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Documentos</label>
            {cargandoDocs ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>⏳ Buscando certificados y trazabilidades de esta OT...</p>
            ) : !documentos || documentos.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aún no hay certificados ni trazabilidades subidas para esta OT.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {documentos.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, textAlign: 'left', textDecoration: 'none', display: 'block' }}
                  >
                    👁 Ver {doc.tipo} — {doc.nombre}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={copiarMensaje}>📋 Copiar mensaje</button>
          <a className="btn" href={linkGmail} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            📧 Abrir en Gmail para enviar
          </a>
        </div>
      </div>
    </div>
  )
}

export default function SeguimientoCertificados({ profile, onLogout }) {
  const navigate = useNavigate()
  const [servicios, setServicios] = useState([])
  const [documentos, setDocumentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('seguimiento') // 'seguimiento' | 'sin_documentos'
  const [busqueda, setBusqueda] = useState('')
  const [modalRecordatorio, setModalRecordatorio] = useState(null)

  const acceso = AREAS_PERMITIDAS.includes(profile?.area)
  const puedeEditar = AREAS_EDITAN.includes(profile?.area)

  async function cargarDatos() {
    setLoading(true)
    const [{ data: svcs, error: errSvcs }, { data: docs, error: errDocs }] = await Promise.all([
      supabase.from('services').select('id, ot_number, client, ruc, status, due_date, ingresos, correo, contacto'),
      supabase.from('documentos').select('id, ot_number, tipo_documento, nombre_archivo, ruta_minio, created_at')
        .or(['certificado', 'trazabilidad'].map((t) => `tipo_documento.ilike.${t}`).join(',')),
    ])
    if (errSvcs) console.error('Error cargando servicios:', errSvcs)
    if (errDocs) console.error('Error cargando documentos:', errDocs)
    setServicios(svcs || [])
    setDocumentos(docs || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!acceso) return
    cargarDatos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceso])

  // ── Combina servicios + documentos en una sola fila por OT ─────────────
  const filas = useMemo(() => {
    const docsPorOT = {}
    for (const d of documentos) {
      if (!docsPorOT[d.ot_number]) docsPorOT[d.ot_number] = { certificados: [], trazabilidades: [] }
      const tipoLower = (d.tipo_documento || '').toLowerCase()
      if (tipoLower === 'certificado') docsPorOT[d.ot_number].certificados.push(d)
      else if (tipoLower === 'trazabilidad') docsPorOT[d.ot_number].trazabilidades.push(d)
    }

    return servicios.map((s) => {
      const equipos = contarEquipos(s.ingresos)
      const docs = docsPorOT[s.ot_number] || { certificados: [], trazabilidades: [] }
      const estado = calcularEstado(equipos, docs.certificados.length, docs.trazabilidades.length)
      return {
        ...s,
        equipos,
        certificados: docs.certificados.length,
        trazabilidades: docs.trazabilidades.length,
        docsCertificados: docs.certificados,
        docsTrazabilidades: docs.trazabilidades,
        estado,
      }
    })
  }, [servicios, documentos])

  const kpis = useMemo(() => {
    const conEquipos = filas.filter((f) => f.equipos > 0)
    const sinDocs = conEquipos.filter((f) => f.estado === 'sin_documentos')
    const parciales = conEquipos.filter((f) => f.estado === 'parcial')
    const completas = conEquipos.filter((f) => f.estado === 'completo')
    const equiposPendientes = conEquipos.reduce((acc, f) => acc + Math.max(0, f.equipos - Math.min(f.certificados, f.trazabilidades)), 0)
    return {
      totalOTs: conEquipos.length,
      sinDocs: sinDocs.length,
      parciales: parciales.length,
      completas: completas.length,
      equiposPendientes,
    }
  }, [filas])

  const filasFiltradas = useMemo(() => {
    return filas
      .filter((f) => f.equipos > 0)
      .filter((f) => {
        if (tab === 'sin_documentos') return f.estado !== 'completo'
        return true
      })
      .filter((f) => {
        if (!busqueda.trim()) return true
        const q = busqueda.trim().toLowerCase()
        return (f.ot_number || '').toLowerCase().includes(q) || (f.client || '').toLowerCase().includes(q)
      })
      .sort((a, b) => {
        const orden = { sin_documentos: 0, parcial: 1, completo: 2, sin_equipos: 3 }
        return orden[a.estado] - orden[b.estado]
      })
  }, [filas, tab, busqueda])

  async function abrirRecordatorio(fila) {
    const correo = fila.correo || ''
    if (!correo) {
      alert('Esta OT no tiene un correo de contacto registrado en MetroTrack (pestaña Datos).')
      return
    }
    const mensaje = armarMensajeRecordatorio(fila.ot_number, fila.client, fila.equipos, fila.certificados, fila.trazabilidades)
    setModalRecordatorio({
      ot: fila,
      correo,
      mensaje,
      cargandoDocs: false,
      documentos: [...fila.docsCertificados, ...fila.docsTrazabilidades].map((d) => ({
        id: d.id, tipo: d.tipo_documento, nombre: d.nombre_archivo, url: construirEnlaceDocumento(d.ruta_minio),
      })),
    })
  }

  if (!acceso) {
    return (
      <div className="container" style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
        <h2>Acceso no autorizado</h2>
        <p style={{ color: 'var(--text-muted)' }}>Esta herramienta es solo para administración por ahora.</p>
        <a className="link-back" onClick={() => navigate('/')}>&larr; Volver al panel</a>
      </div>
    )
  }

  return (
    <div className="container container-ancho" style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div className="top-bar" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <a className="link-back" onClick={() => navigate('/')}>&larr; Volver al panel</a>
          <h2 style={{ margin: '8px 0 0' }}>🔬 Certificados y Trazabilidades</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>Seguimiento de Laboratorio — Administración</p>
        </div>
        {onLogout && <button className="btn btn-secondary" onClick={onLogout}>Salir</button>}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '20px 0' }}>
        <KpiCard label="OTs con equipos" value={kpis.totalOTs} />
        <KpiCard label="Sin documentos" value={kpis.sinDocs} color="#c65b3a" />
        <KpiCard label="Parciales" value={kpis.parciales} color="#a97a2e" />
        <KpiCard label="Completas" value={kpis.completas} color="#4c8a63" />
        <KpiCard label="Equipos pendientes" value={kpis.equiposPendientes} sub="Sin certificado o trazabilidad" color="#a35f27" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setTab('seguimiento')}
          style={{ padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: tab === 'seguimiento' ? 'var(--ocean-accent)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === 'seguimiento' ? 'var(--ocean-accent)' : 'transparent'}` }}
        >
          🔬 Seguimiento
        </button>
        <button
          onClick={() => setTab('sin_documentos')}
          style={{ padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: tab === 'sin_documentos' ? 'var(--ocean-accent)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === 'sin_documentos' ? 'var(--ocean-accent)' : 'transparent'}` }}
        >
          🚫 Falta algo ({kpis.sinDocs + kpis.parciales})
        </button>
      </div>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por OT o cliente..."
        style={{ maxWidth: 320, marginBottom: 14 }}
      />

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 16, color: 'var(--text-muted)' }}>Cargando...</p>
        ) : filasFiltradas.length === 0 ? (
          <p style={{ padding: 16, color: 'var(--text-muted)' }}>No hay OTs que coincidan.</p>
        ) : (
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '65vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['OT', 'Cliente', 'Equipos', 'Certificados', 'Trazabilidades', 'Estado', 'Recordar'].map((h) => (
                    <th key={h} style={{ position: 'sticky', top: 0, background: 'var(--panel-bg, #0f172a)', padding: '10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((f) => (
                  <tr key={f.id}>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                      <a onClick={() => navigate(`/ot/${f.ot_number}`)} style={{ cursor: 'pointer', color: 'var(--ocean-accent)' }}>{f.ot_number}</a>
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.client || '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>{f.equipos}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', fontWeight: 700, color: f.certificados >= f.equipos ? '#4c8a63' : '#c65b3a' }}>
                      {f.certificados} / {f.equipos}
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', fontWeight: 700, color: f.trazabilidades >= f.equipos ? '#4c8a63' : '#c65b3a' }}>
                      {f.trazabilidades} / {f.equipos}
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}><Badge estado={f.estado} /></td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                      {puedeEditar && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => abrirRecordatorio(f)}>
                          📧 Recordar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalRecordatorio && (
        <ModalRecordatorio
          datos={modalRecordatorio}
          onClose={() => setModalRecordatorio(null)}
          onCambiarMensaje={(m) => setModalRecordatorio((prev) => ({ ...prev, mensaje: m }))}
        />
      )}
    </div>
  )
}
