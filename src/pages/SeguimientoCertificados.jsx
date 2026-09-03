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

// ── Cuentas disponibles como remitente ────────────────────────────────
// Se puede elegir en el modal — la app no puede forzar cuál usa Gmail
// (eso depende de qué cuentas tengas logueadas en el navegador), pero al
// menos deja armar el enlace con la que corresponda.
const CUENTAS_REMITENTE = [
  { valor: 'laboratorio@metromecanica.com.pe', etiqueta: 'Laboratorio' },
  { valor: 'contabilidad@metromecanica.com.pe', etiqueta: 'Contabilidad' },
  { valor: 'admin@metromecanica.com.pe', etiqueta: 'Administración' },
]

// ── Página pública para compartir documentos (sin login) ─────────────
// Enlaces individuales organizados por carpeta — sin depender de ningún
// workflow adicional de n8n. Cada enlace usa el mismo endpoint robusto
// (ver-documento) que ya funciona en toda la app.
// Compositor web de Gmail — ahora recibe el remitente como parámetro (en
// vez de una constante fija), para que se pueda elegir en el modal.
function construirLinkCorreo(destinatario, asunto, cuerpo, remitente) {
  const params = new URLSearchParams({
    view: 'cm', fs: '1', to: destinatario, su: asunto, body: cuerpo,
    authuser: remitente,
  })
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
// Antes "Parcial" y "Sin docs" eran dos tonos café/naranja muy parecidos —
// ahora usan matices claramente distintos (ámbar dorado vs. rojo intenso)
// para que se distingan de un vistazo, no solo por el texto.
const ESTADO_CFG = {
  completo: { color: '#2f8f5b', titulo: 'Certificados y trazabilidades completos', texto: 'COMPLETO' },
  parcial: { color: '#d9a418', titulo: 'Faltan certificados o trazabilidades de algunos equipos', texto: 'PARCIAL' },
  sin_documentos: { color: '#c0392b', titulo: 'Sin certificados ni trazabilidades subidas', texto: 'SIN DOCS' },
  sin_equipos: { color: '#6b7280', titulo: 'Esta OT no tiene equipos registrados en Ingresos', texto: 'SIN EQUIPOS' },
}

function calcularEstado(equipos, certificados, trazabilidades) {
  if (equipos === 0) return 'sin_equipos'
  if (certificados === 0 && trazabilidades === 0) return 'sin_documentos'
  if (certificados >= equipos && trazabilidades >= equipos) return 'completo'
  return 'parcial'
}

// ── Mensaje del correo — versión completa ─────────────────────────────
// Incluye el detalle de cada equipo (no solo el conteo) y cambia el cierre
// según si ya está todo listo o si aún falta algo, para que el mensaje
// tenga sentido en ambos casos sin sonar genérico.
// ── Valores placeholder que no deben mostrarse al cliente tal cual ───────
// Cuando el técnico no especifica marca/modelo, el sistema de Ingresos
// guarda literalmente "NO INDICA" — mostrarlo en un correo se ve poco
// profesional, así que se omite en vez de imprimirlo.
const VALORES_SIN_DATO = ['no indica', 'no especifica', 's/n', 'sin serie', 'n/a', '']

function tieneValorReal(valor) {
  return valor && !VALORES_SIN_DATO.includes(valor.trim().toLowerCase())
}

// ── Mensaje formal, estilo carta de entrega — con enlaces individuales
// organizados en 2 secciones (Certificados / Trazabilidad). Cada enlace usa
// el endpoint robusto (ver-documento) que ya funciona en toda la app —
// sin depender de ningún workflow nuevo de n8n.
function armarMensajeRecordatorio(fila) {
  const { ot_number, client, docsCertificados, docsTrazabilidades } = fila

  const lineasAdjuntos = []
  if (docsCertificados.length > 0) {
    lineasAdjuntos.push(
      `CERTIFICADOS DE CALIBRACIÓN (${docsCertificados.length}):`,
      ...docsCertificados.map((d) => `⚫ ${d.nombre_archivo}\n  ${construirEnlaceDocumento(d.ruta_minio)}`)
    )
  }
  if (docsTrazabilidades.length > 0) {
    if (lineasAdjuntos.length > 0) lineasAdjuntos.push('')
    lineasAdjuntos.push(
      `TRAZABILIDAD (${docsTrazabilidades.length}):`,
      ...docsTrazabilidades.map((d) => `⚫ ${d.nombre_archivo}\n  ${construirEnlaceDocumento(d.ruta_minio)}`)
    )
  }

  return [
    `Sr(es): ${client || '—'},`,
    '',
    `Mediante la presente se hace llegar los certificados de calibración y/o documentos de trazabilidad correspondientes a la Orden de Trabajo ${ot_number}.`,
    '',
    ...lineasAdjuntos,
    '',
    'Favor confirmar la recepción de los documentos por este medio.',
    '',
    'OBSERVACIONES:',
    'Ante cualquier consulta sobre el detalle técnico de los certificados, no dude en escribirnos.',
    '',
    'Atte.',
    '',
    'E. Gabriel Ramírez Flores',
    'Laboratorio MetroMecánica',
    'laboratorio@metromecanica.com.pe',
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
      style={{
        fontSize: 11, fontWeight: 800, color: cfg.color, background: `${cfg.color}20`,
        border: `1px solid ${cfg.color}55`, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap',
      }}
    >
      {cfg.texto}
    </span>
  )
}

// ── Modal de recordatorio — mismo patrón que Seguimiento de Facturas ────
function ModalRecordatorio({ datos, onClose, onCambiarMensaje, onRegistrarEnvio }) {
  const { ot, correo, mensaje, cargandoDocs, documentos } = datos
  const [remitente, setRemitente] = useState(CUENTAS_REMITENTE[0].valor)
  const linkGmail = construirLinkCorreo(correo, `Certificados de calibración — ${ot.ot_number}`, mensaje, remitente)

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
          <strong style={{ fontSize: 16 }}>📧 Enviar certificados — OT {ot.ot_number}</strong>
          <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onClose}>✕ Cerrar</button>
        </div>

        <div style={{ padding: '20px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }}>Para</label>
              <input value={correo} readOnly style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }}>Enviar desde</label>
              <select
                value={remitente}
                onChange={(e) => setRemitente(e.target.value)}
                style={{ width: '100%', color: '#16232b', background: '#fff', fontWeight: 700 }}
              >
                {CUENTAS_REMITENTE.map((c) => (
                  <option key={c.valor} value={c.valor} style={{ color: '#16232b' }}>{c.etiqueta}</option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-10px 0 0' }}>
            Solo funciona si esa cuenta ya está logueada en tu navegador — si no, Gmail abrirá con la que sí lo esté.
          </p>

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
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Documentos (ya incluidos arriba, organizados por carpeta)</label>
            {cargandoDocs ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>⏳ Buscando certificados y trazabilidades de esta OT...</p>
            ) : !documentos || documentos.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aún no hay certificados ni trazabilidades subidas para esta OT.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
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
          <a
            className="btn"
            href={linkGmail}
            target="_blank"
            rel="noreferrer"
            title={`Gmail — ${remitente}`}
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            onClick={() => onRegistrarEnvio(ot.ot_number)}
          >
            📧 Abrir en Gmail para enviar
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Fondo del toro — imagen real con movimiento sutil ────────────────────
// Reemplaza el fondo marino de burbujas por la imagen que subiste a
// Supabase Storage. Se mantiene claro (fondo base blanco/hueso detrás) y la
// foto se atenúa bastante (opacidad baja) para que compita lo menos
// posible con el texto — la imagen es muy oscura y dramática por sí sola.
// Movimiento: "respiración" lenta (zoom sutil) + parallax al mover el
// mouse, mismo mecanismo que en Facturas y en el fondo marino anterior.
const URL_IMAGEN_TORO = 'https://ndcjjksaiecsuzperrhp.supabase.co/storage/v1/object/public/ot-files/toro_fondo.png'

function FondoToroAnimado() {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    function onMove(e) {
      setOffset({
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, #f6f4ee 0%, #f0ede4 55%, #e9e4d8 100%)' }} />
      <div
        style={{
          position: 'absolute',
          right: '-8%',
          bottom: '-6%',
          width: 'min(65%, 820px)',
          transform: `translate(${offset.x * 14}px, ${offset.y * 14}px)`,
          transition: 'transform 0.4s ease-out',
        }}
      >
        <img
          src={URL_IMAGEN_TORO}
          alt=""
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            opacity: 0.16,
            filter: 'grayscale(0.25) contrast(0.9) brightness(1.05)',
            animation: 'respiroToro 13s ease-in-out infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes respiroToro {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.035); }
        }
        @media (prefers-reduced-motion: reduce) {
          .certificados-tema-marino [style*="animation"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

// ── Filtros persistidos en sessionStorage ────────────────────────────────
// Sin esto, cualquier navegación fuera de esta pantalla (clic en una OT,
// volver al Portal y reabrir la herramienta) resetea los filtros — muy
// molesto cuando ya tenías armado un rango de fechas específico. Con
// sessionStorage sobreviven mientras la pestaña del navegador siga
// abierta, sin importar por dónde navegues y vuelvas.
const CLAVE_FILTROS = 'certificados_filtros'

function leerFiltrosGuardados() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_FILTROS)) || {}
  } catch {
    return {}
  }
}

export default function SeguimientoCertificados({ profile, onLogout }) {
  const navigate = useNavigate()
  const [servicios, setServicios] = useState([])
  const [documentos, setDocumentos] = useState([])
  const [ultimoEnvioPorOT, setUltimoEnvioPorOT] = useState({})
  const [loading, setLoading] = useState(true)
  const filtrosGuardados = leerFiltrosGuardados()
  const [tab, setTab] = useState(filtrosGuardados.tab || 'seguimiento') // 'seguimiento' | 'sin_documentos'
  const [busqueda, setBusqueda] = useState(filtrosGuardados.busqueda || '')
  const [fechaDesde, setFechaDesde] = useState(filtrosGuardados.fechaDesde || '')
  const [fechaHasta, setFechaHasta] = useState(filtrosGuardados.fechaHasta || '')
  const [modalRecordatorio, setModalRecordatorio] = useState(null)
  const [mesSeleccionado, setMesSeleccionado] = useState(filtrosGuardados.mesSeleccionado || '')
  const [anioSeleccionado, setAnioSeleccionado] = useState(filtrosGuardados.anioSeleccionado || '')

  // Cada vez que cambia cualquier filtro, se guarda de inmediato — así la
  // próxima vez que se entre a esta pantalla (aunque el componente se haya
  // desmontado por completo) arranca igual a como se dejó.
  useEffect(() => {
    sessionStorage.setItem(CLAVE_FILTROS, JSON.stringify({
      tab, busqueda, fechaDesde, fechaHasta, mesSeleccionado, anioSeleccionado,
    }))
  }, [tab, busqueda, fechaDesde, fechaHasta, mesSeleccionado, anioSeleccionado])

  // Atajo: elegir mes + año rellena "Desde"/"Hasta" automáticamente con el
  // primer y último día de ese mes — reemplaza el <input type="month">
  // nativo (confuso, se veía como "---------- de ----") por dos selectores
  // directos y grandes.
  function aplicarMesRapido(mes, anio) {
    if (!mes || !anio) { setFechaDesde(''); setFechaHasta(''); return }
    const mesNum = Number(mes)
    const ultimoDia = new Date(Number(anio), mesNum, 0).getDate()
    setFechaDesde(`${anio}-${String(mesNum).padStart(2, '0')}-01`)
    setFechaHasta(`${anio}-${String(mesNum).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`)
  }

  const acceso = AREAS_PERMITIDAS.includes(profile?.area)
  const puedeEditar = AREAS_EDITAN.includes(profile?.area)

  async function cargarDatos() {
    setLoading(true)
    const [{ data: svcs, error: errSvcs }, { data: docs, error: errDocs }, { data: envios, error: errEnvios }] = await Promise.all([
      supabase.from('services').select('id, ot_number, client, ruc, status, due_date, ingresos, correo, contacto'),
      supabase.from('documentos').select('id, ot_number, tipo_documento, nombre_archivo, ruta_minio, created_at')
        .or(['certificado', 'trazabilidad'].map((t) => `tipo_documento.ilike.${t}`).join(',')),
      supabase.from('envios_certificados').select('ot_number, enviado_en').order('enviado_en', { ascending: false }),
    ])
    if (errSvcs) console.error('Error cargando servicios:', errSvcs)
    if (errDocs) console.error('Error cargando documentos:', errDocs)
    if (errEnvios) console.error('Error cargando envíos:', errEnvios)
    setServicios(svcs || [])
    setDocumentos(docs || [])
    // Solo el envío más reciente por OT (la lista ya viene ordenada desc).
    const mapaEnvios = {}
    for (const e of envios || []) {
      if (!mapaEnvios[e.ot_number]) mapaEnvios[e.ot_number] = e.enviado_en
    }
    setUltimoEnvioPorOT(mapaEnvios)
    setLoading(false)
  }

  // Se llama al hacer clic en "Abrir en Gmail para enviar" — deja constancia
  // de que esa OT ya se le mandó correo, sin bloquear nada (no se espera).
  function registrarEnvio(otNumber) {
    supabase.from('envios_certificados').insert({ ot_number: otNumber }).then(({ error }) => {
      if (error) { console.error('No se pudo registrar el envío:', error); return }
      setUltimoEnvioPorOT((prev) => ({ ...prev, [otNumber]: new Date().toISOString() }))
    })
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
        ultimoEnvio: ultimoEnvioPorOT[s.ot_number] || null,
      }
    })
  }, [servicios, documentos, ultimoEnvioPorOT])

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
      .filter((f) => {
        if (!fechaDesde && !fechaHasta) return true
        if (!f.due_date) return false
        if (fechaDesde && f.due_date < fechaDesde) return false
        if (fechaHasta && f.due_date > fechaHasta) return false
        return true
      })
      .sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date) - new Date(b.due_date)
      })
  }, [filas, tab, busqueda, fechaDesde, fechaHasta])

  // ── Siempre la página pública, sin importar cuántos documentos haya ────
  // El modal aparece de inmediato con lo que ya se tiene; el enlace se
  // agrega al mensaje apenas está listo, en segundo plano, sin bloquear
  // ── Genera los ZIP de certificados y trazabilidad en segundo plano ─────
  // Aparece de inmediato — todos los enlaces se construyen directo de los
  // datos que ya tenemos cargados, sin ninguna llamada de red adicional.
  function abrirRecordatorio(fila) {
    const correo = fila.correo || ''
    if (!correo) {
      alert('Esta OT no tiene un correo de contacto registrado en MetroTrack (pestaña Datos).')
      return
    }
    const documentos = [...fila.docsCertificados, ...fila.docsTrazabilidades].map((d) => ({
      id: d.id, tipo: d.tipo_documento, nombre: d.nombre_archivo, url: construirEnlaceDocumento(d.ruta_minio),
    }))

    setModalRecordatorio({ ot: fila, correo, mensaje: armarMensajeRecordatorio(fila), cargandoDocs: false, documentos })
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
    <div className="container container-ancho certificados-tema-marino" style={{ maxWidth: 1500, margin: '0 auto', position: 'relative', minHeight: '100vh' }}>
      <style>{`
        .certificados-tema-marino {
          --ocean-accent: #1f7a8c;
          --border: #b9dde8;
          --text: #16232b;
          --text-muted: #4a6470;
          --danger: #c65b3a;
        }
        .certificados-tema-marino .card {
          border-radius: 16px;
          border-color: rgba(31, 122, 140, 0.28);
          background: rgba(240, 251, 253, 0.85);
          backdrop-filter: blur(2px);
          color: #16232b;
        }
        .certificados-tema-marino input {
          background: rgba(255, 253, 250, 0.92);
          color: #16232b;
          border-color: rgba(31, 122, 140, 0.3);
        }
        .certificados-tema-marino .btn {
          background: #1f7a8c;
          color: #f0fbfd;
          border-radius: 10px;
          border: none;
        }
        .certificados-tema-marino .btn-secondary {
          border-radius: 10px;
          border-color: rgba(31, 122, 140, 0.35);
          background: rgba(31, 122, 140, 0.08);
          color: #163542;
        }
        .certificados-tema-marino h1,
        .certificados-tema-marino h2,
        .certificados-tema-marino h3,
        .certificados-tema-marino h4,
        .certificados-tema-marino strong {
          color: #101c22 !important;
        }
        .certificados-tema-marino p,
        .certificados-tema-marino label,
        .certificados-tema-marino th {
          color: #375160 !important;
        }
        .certificados-tema-marino .link-back {
          color: #1a6b7a !important;
          font-weight: 700;
        }
        .certificados-tema-marino td {
          color: #16232b;
        }
        .certificados-tema-marino a {
          color: #1a6b7a;
        }
      `}</style>
      <FondoToroAnimado />
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#16232b', marginBottom: 5 }}>Buscar</label>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por OT o cliente..."
            style={{ width: 260, fontSize: 16, fontWeight: 700, padding: '10px 12px', border: '3px solid var(--ocean-accent)', borderRadius: 10 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#16232b', marginBottom: 5 }}>Mes rápido</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={mesSeleccionado}
              onChange={(e) => { setMesSeleccionado(e.target.value); aplicarMesRapido(e.target.value, anioSeleccionado) }}
              style={{ width: 140, fontSize: 16, fontWeight: 800, padding: '10px 8px', border: '3px solid var(--ocean-accent)', borderRadius: 10, color: '#16232b' }}
            >
              <option value="">Mes</option>
              {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((nombre, i) => (
                <option key={i} value={i + 1}>{nombre}</option>
              ))}
            </select>
            <select
              value={anioSeleccionado}
              onChange={(e) => { setAnioSeleccionado(e.target.value); aplicarMesRapido(mesSeleccionado, e.target.value) }}
              style={{ width: 100, fontSize: 16, fontWeight: 800, padding: '10px 8px', border: '3px solid var(--ocean-accent)', borderRadius: 10, color: '#16232b' }}
            >
              <option value="">Año</option>
              {[2025, 2026, 2027, 2028].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#16232b', marginBottom: 5 }}>Desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            style={{ width: 175, fontSize: 16, fontWeight: 800, padding: '10px 12px', border: '3px solid var(--ocean-accent)', borderRadius: 10, color: '#16232b' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#16232b', marginBottom: 5 }}>Hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            style={{ width: 175, fontSize: 16, fontWeight: 800, padding: '10px 12px', border: '3px solid var(--ocean-accent)', borderRadius: 10, color: '#16232b' }}
          />
        </div>
        {(fechaDesde || fechaHasta) && (
          <button className="btn btn-secondary" style={{ fontSize: 14, fontWeight: 800, padding: '10px 16px' }} onClick={() => { setFechaDesde(''); setFechaHasta('') }}>
            ✕ Limpiar fechas
          </button>
        )}
      </div>

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
                  {['OT', 'Fecha', 'Cliente', 'Equipos', 'Certificados', 'Trazabilidades', 'Estado', 'Envío', 'Enviar'].map((h) => (
                    <th key={h} style={{ position: 'sticky', top: 0, background: 'rgba(240, 251, 253, 0.97)', padding: '10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>
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
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{fmtFecha(f.due_date)}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.client || '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>{f.equipos}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', fontWeight: 700, color: f.certificados >= f.equipos ? '#4c8a63' : '#c65b3a' }}>
                      {f.certificados} / {f.equipos}
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', fontWeight: 700, color: f.trazabilidades >= f.equipos ? '#4c8a63' : '#c65b3a' }}>
                      {f.trazabilidades} / {f.equipos}
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}><Badge estado={f.estado} /></td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap', fontSize: 11.5 }}>
                      {f.ultimoEnvio ? (
                        <span style={{ color: '#2f8f5b', fontWeight: 700 }} title={new Date(f.ultimoEnvio).toLocaleString('es-PE')}>
                          ✉ Enviado {fmtFecha(f.ultimoEnvio.slice(0, 10))}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>— Sin enviar</span>
                      )}
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                      {puedeEditar && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => abrirRecordatorio(f)}>
                          📧 Enviar
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
          onRegistrarEnvio={registrarEnvio}
        />
      )}
    </div>
  )
}