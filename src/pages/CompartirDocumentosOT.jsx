import { useEffect, useState, Component } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

// ── Página pública — SIN login ──────────────────────────────────────────
// A diferencia de todo el resto de la app, esta ruta no exige sesión (ver
// App.jsx). El acceso no depende de adivinar el número de OT: además hace
// falta el "token" de la URL, generado una sola vez por OT y guardado en
// la tabla enlaces_compartidos — sin eso, el endpoint de n8n no devuelve
// nada, aunque el número de OT sea correcto.
const WEBHOOK_LISTAR_DOCUMENTOS = "https://panel.5-189-165-144.sslip.io/api-patrones/listar-documentos-ot"
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

  useEffect(() => {
    async function cargar() {
      if (!token) {
        setEstado('sin_acceso')
        return
      }
      try {
        const resp = await fetch(`${WEBHOOK_LISTAR_DOCUMENTOS}?ot=${encodeURIComponent(otNumber)}&token=${encodeURIComponent(token)}`)
        if (!resp.ok) {
          setEstado('sin_acceso')
          return
        }
        // Sin importar qué devuelva exactamente n8n (array, objeto vacío,
        // null, etc.), "documentos" siempre queda como un array real —
        // así el resto del componente nunca puede explotar al iterarlo.
        const data = await resp.json().catch(() => null)
        const lista = Array.isArray(data) ? data : []
        setDocumentos(lista)
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

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <img src={LOGO_URL} alt="MetroMecánica" style={{ width: 48, height: 48, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 4 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#16232b' }}>MetroMecánica Ingeniería y Metrología S.A.C.</div>
            <div style={{ fontSize: 13, color: '#5c6d7a' }}>Documentos de la orden {otNumber}</div>
          </div>
        </div>

        {estado === 'cargando' && (
          <div style={{ textAlign: 'center', padding: 60, color: '#5c6d7a' }}>Cargando documentos...</div>
        )}

        {estado === 'sin_acceso' && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🔒</div>
            <div style={{ fontWeight: 700, color: '#16232b', marginBottom: 6 }}>Este enlace no es válido</div>
            <p style={{ color: '#5c6d7a', fontSize: 14, margin: 0 }}>
              Verifica que copiaste el enlace completo desde el correo, o solicita uno nuevo a MetroMecánica.
            </p>
          </div>
        )}

        {estado === 'error' && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 700, color: '#c0392b' }}>No se pudo cargar la información en este momento.</div>
            <p style={{ color: '#5c6d7a', fontSize: 14 }}>Intenta de nuevo en unos minutos.</p>
          </div>
        )}

        {estado === 'ok' && documentos.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', border: '1px solid #e2e8f0', color: '#5c6d7a' }}>
            Aún no hay documentos disponibles para esta orden.
          </div>
        )}

        {estado === 'ok' && documentos.length > 0 && Object.entries(grupos).map(([tipo, docs]) => (
          <CarpetaDocumentos key={tipo} tipo={tipo} docs={docs} />
        ))}

        <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 30 }}>
          Este enlace es de uso exclusivo para el cliente de esta orden de trabajo. Ante cualquier duda, contáctenos.
        </p>
      </div>
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