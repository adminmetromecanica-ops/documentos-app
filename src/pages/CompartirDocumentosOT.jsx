import { useEffect, useState, Component } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// ── Página pública — SIN login ──────────────────────────────────────────
// A diferencia de todo el resto de la app, esta ruta no exige sesión (ver
// App.jsx). Consulta Supabase DIRECTO desde el navegador del cliente (con
// la clave pública/anon) — sin pasar por n8n. Esto elimina de raíz los
// problemas de cableado que tuvimos con el workflow "listar-documentos-ot":
// menos piezas, más fácil de verificar que funciona.
//
// Seguridad: las políticas RLS en Supabase solo dejan ver `documentos` de
// una OT si esa OT tiene al menos un registro en `enlaces_compartidos` —
// es decir, únicamente las OT que alguien de MetroMecánica decidió
// compartir explícitamente quedan visibles sin sesión. El "token" de la
// URL se verifica aparte, contra esa misma tabla, para confirmar que es
// el enlace correcto antes de mostrar nada.
const LOGO_URL = 'https://ndcjjksaiecsuzperrhp.supabase.co/storage/v1/object/public/ot-files/logo.png'
const WEBHOOK_VER_DOCUMENTO_REDIRECT = "https://panel.5-189-165-144.sslip.io/api-patrones/ver-documento"

function construirEnlaceDocumento(rutaMinio) {
  return `${WEBHOOK_VER_DOCUMENTO_REDIRECT}?ruta=${encodeURIComponent(rutaMinio)}`
}

const ETIQUETA_TIPO = {
  certificado: { icono: '📜', titulo: 'Certificados de Calibración' },
  trazabilidad: { icono: '🔗', titulo: 'Registros de Trazabilidad' },
  factura: { icono: '🧾', titulo: 'Facturas' },
  'factura xml': { icono: '🗂', titulo: 'Facturas (XML)' },
  proforma: { icono: '📋', titulo: 'Proformas' },
  'orden de compra': { icono: '🛒', titulo: 'Órdenes de Compra' },
  cotización: { icono: '💵', titulo: 'Cotizaciones' },
}

function etiquetaDe(tipoDocumento) {
  const key = (tipoDocumento || '').toLowerCase()
  return ETIQUETA_TIPO[key] || { icono: '📄', titulo: tipoDocumento || 'Otros documentos' }
}

// Carpeta colapsable por tipo de documento — mismo patrón visual que ya
// usamos en "Documentos subidos" dentro de las OT (ícono + título + badge
// contador redondo, se expande al hacer clic).
function CarpetaDocumentos({ tipo, docs }) {
  const [abierta, setAbierta] = useState(true)
  const etiqueta = etiquetaDe(tipo)
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 14 }}>
      <button
        onClick={() => setAbierta((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', border: 'none', background: '#f7fbfc', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: '#1f7a8c', transform: abierta ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
          <span style={{ fontSize: 20 }}>{etiqueta.icono}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#16232b' }}>{etiqueta.titulo}</span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, background: '#1f7a8c', color: '#fff', borderRadius: 999, padding: '3px 12px', minWidth: 24, textAlign: 'center' }}>
          {docs.length}
        </span>
      </button>
      {abierta && (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map((d, i) => (
            <a
              key={i}
              href={construirEnlaceDocumento(d.ruta_minio)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8, border: '1px solid #dde4e9',
                background: '#fafbfc', textDecoration: 'none', color: '#16232b', fontSize: 13,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12 }}>{d.nombre_archivo}</span>
              <span style={{ color: '#1f7a8c', fontWeight: 700, flexShrink: 0 }}>👁 Ver / Descargar</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Red de seguridad — si algo explota, muestra un mensaje en vez de
// dejar la pantalla en blanco (crítico en una página que ve un cliente
// externo, sin nadie de MetroMecánica para avisar que algo se rompió).
class ErrorBoundaryCompartir extends Component {
  constructor(props) { super(props); this.state = { hayError: false } }
  static getDerivedStateFromError() { return { hayError: true } }
  componentDidCatch(error, info) { console.error('Error en página pública de documentos:', error, info) }
  render() {
    if (this.state.hayError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0', maxWidth: 420 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⚠</div>
            <div style={{ fontWeight: 700, color: '#16232b', marginBottom: 6 }}>Ocurrió un problema al mostrar esta página</div>
            <p style={{ color: '#5c6d7a', fontSize: 14, margin: 0 }}>Por favor, contacte a MetroMecánica para obtener sus documentos.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function CompartirDocumentosOTInterno() {
  const { otNumber } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [estado, setEstado] = useState('cargando') // 'cargando' | 'ok' | 'sin_acceso' | 'error'
  const [documentos, setDocumentos] = useState([])
  const [clienteNombre, setClienteNombre] = useState('')

  useEffect(() => {
    async function cargar() {
      if (!token) {
        setEstado('sin_acceso')
        return
      }
      try {
        // 1) Verifica que el token corresponda a esta OT específica.
        const { data: enlace, error: errEnlace } = await supabase
          .from('enlaces_compartidos')
          .select('token')
          .eq('ot_number', otNumber)
          .eq('token', token)
          .maybeSingle()
        if (errEnlace) {
          console.error('Error verificando el enlace:', errEnlace)
          setEstado('error')
          return
        }
        if (!enlace) {
          setEstado('sin_acceso')
          return
        }

        // 2) Trae los documentos — la política RLS ya solo deja ver los de
        // una OT que tenga al menos un enlace compartido (verificado arriba).
        const [{ data, error: errDocs }, { data: svc }] = await Promise.all([
          supabase
            .from('documentos')
            .select('tipo_documento, nombre_archivo, ruta_minio, created_at')
            .eq('ot_number', otNumber)
            .order('tipo_documento', { ascending: true })
            .order('created_at', { ascending: false }),
          supabase.from('services').select('client').eq('ot_number', otNumber).maybeSingle(),
        ])
        if (errDocs) {
          console.error('Error cargando documentos:', errDocs)
          setEstado('error')
          return
        }
        setDocumentos(Array.isArray(data) ? data : [])
        setClienteNombre(svc?.client || '')
        setEstado('ok')
      } catch (e) {
        console.error('Error cargando documentos compartidos:', e)
        setEstado('error')
      }
    }
    cargar()
  }, [otNumber, token])

  const grupos = {}
  for (const d of documentos) {
    const key = (d?.tipo_documento || 'otros').toLowerCase()
    if (!grupos[key]) grupos[key] = []
    grupos[key].push(d)
  }
  const certificados = grupos['certificado'] || []
  const trazabilidades = grupos['trazabilidad'] || []
  const otrosGrupos = Object.entries(grupos).filter(([k]) => k !== 'certificado' && k !== 'trazabilidad')

  function irA(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#eef1f5', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      {estado === 'cargando' && (
        <div style={{ textAlign: 'center', padding: 80, color: '#5c6d7a' }}>Cargando documentos...</div>
      )}

      {estado === 'sin_acceso' && (
        <div style={{ maxWidth: 480, margin: '80px auto', background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🔒</div>
          <div style={{ fontWeight: 700, color: '#16232b', marginBottom: 6 }}>Este enlace no es válido</div>
          <p style={{ color: '#5c6d7a', fontSize: 14, margin: 0 }}>
            Verifica que copiaste el enlace completo desde el correo, o solicita uno nuevo a MetroMecánica.
          </p>
        </div>
      )}

      {estado === 'error' && (
        <div style={{ maxWidth: 480, margin: '80px auto', background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 700, color: '#c0392b' }}>No se pudo cargar la información en este momento.</div>
          <p style={{ color: '#5c6d7a', fontSize: 14 }}>Intenta de nuevo en unos minutos.</p>
        </div>
      )}

      {estado === 'ok' && (
        <>
          {/* ── Hero ── */}
          <div style={{ background: 'linear-gradient(135deg, #16233b 0%, #1d3a5f 100%)', padding: '48px 20px 56px', textAlign: 'center', color: '#fff' }}>
            <img src={LOGO_URL} alt="MetroMecánica" style={{ width: 56, height: 56, objectFit: 'contain', background: '#fff', borderRadius: 10, padding: 6, marginBottom: 18 }} />
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px' }}>
              Estimado(a) {clienteNombre || 'Cliente'},
            </h1>
            <p style={{ fontSize: 15, color: '#c7d2e0', maxWidth: 480, margin: '0 auto 6px', lineHeight: 1.6 }}>
              Adjuntamos los certificados de calibración y documentos de trazabilidad correspondientes a los servicios realizados.
            </p>
            <p style={{ fontSize: 15, color: '#c7d2e0', maxWidth: 480, margin: '0 auto 26px', lineHeight: 1.6 }}>
              Accede de manera rápida y segura a toda la documentación desde el siguiente enlace:
            </p>
            <button
              onClick={() => irA('lista-documentos')}
              style={{
                background: '#2f6fed', color: '#fff', border: 'none', borderRadius: 999,
                padding: '14px 30px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 24px rgba(47,111,237,0.4)',
              }}
            >
              📁 Acceder a mis documentos
            </button>
            <div style={{ fontSize: 12, color: '#8ea1bd', marginTop: 10 }}>Ver certificados y trazabilidades</div>
          </div>

          {/* ── Qué encontrarás ── */}
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ textAlign: 'center', fontSize: 19, fontWeight: 800, color: '#16232b', marginBottom: 24 }}>¿Qué encontrarás?</h2>

            <div style={{ display: 'grid', gridTemplateColumns: certificados.length && trazabilidades.length ? '1fr 1fr' : '1fr', gap: 18, marginBottom: 30 }}>
              {certificados.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>📜</div>
                  <div style={{ fontWeight: 800, fontSize: 14.5, color: '#16232b', marginBottom: 6 }}>CERTIFICADOS DE<br />CALIBRACIÓN</div>
                  <p style={{ fontSize: 13, color: '#5c6d7a', margin: '0 0 16px' }}>Consulta y descarga todos los certificados de calibración emitidos.</p>
                  <button
                    onClick={() => irA('certificados-lista')}
                    style={{ background: '#2f6fed', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}
                  >
                    Ver Certificados ({certificados.length}) →
                  </button>
                </div>
              )}
              {trazabilidades.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>🔗</div>
                  <div style={{ fontWeight: 800, fontSize: 14.5, color: '#16232b', marginBottom: 6 }}>DOCUMENTOS DE<br />TRAZABILIDAD</div>
                  <p style={{ fontSize: 13, color: '#5c6d7a', margin: '0 0 16px' }}>Accede a los documentos de trazabilidad de nuestros patrones.</p>
                  <button
                    onClick={() => irA('trazabilidad-lista')}
                    style={{ background: '#1f9d55', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}
                  >
                    Ver Trazabilidad ({trazabilidades.length}) →
                  </button>
                </div>
              )}
            </div>

            {certificados.length === 0 && trazabilidades.length === 0 && (
              <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0', color: '#5c6d7a', marginBottom: 30 }}>
                Aún no hay certificados ni documentos de trazabilidad disponibles para esta orden.
              </div>
            )}

            {/* ── Confianza ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 40 }}>
              {[
                ['🔒', 'Información segura'],
                ['📋', 'Trazabilidad garantizada'],
                ['🕐', 'Disponible 24/7'],
                ['💬', '¿Dudas o consultas?'],
              ].map(([icono, texto]) => (
                <div key={texto} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18 }}>{icono}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#374151', marginTop: 4 }}>{texto}</div>
                </div>
              ))}
            </div>

            {/* ── Listas detalladas ── */}
            <div id="lista-documentos">
              {certificados.length > 0 && (
                <div id="certificados-lista" style={{ marginBottom: 20 }}>
                  <CarpetaDocumentos tipo="certificado" docs={certificados} />
                </div>
              )}
              {trazabilidades.length > 0 && (
                <div id="trazabilidad-lista" style={{ marginBottom: 20 }}>
                  <CarpetaDocumentos tipo="trazabilidad" docs={trazabilidades} />
                </div>
              )}
              {otrosGrupos.map(([tipo, docs]) => (
                <CarpetaDocumentos key={tipo} tipo={tipo} docs={docs} />
              ))}
            </div>

            <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 20 }}>
              Este enlace es de uso exclusivo para el cliente de esta orden de trabajo. Ante cualquier duda, contáctenos.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default function CompartirDocumentosOT() {
  return (
    <ErrorBoundaryCompartir>
      <CompartirDocumentosOTInterno />
    </ErrorBoundaryCompartir>
  )
}