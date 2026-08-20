import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { AREAS_CONFIG, TODAS_LAS_AREAS } from '../lib/areasConfig'
import UploadForm from '../components/UploadForm'

const WEBHOOK_URL_DOCUMENTO = "https://panel.5-189-165-144.sslip.io/api-patrones/url-documento"
const WEBHOOK_URL_LEER_FACTURA = "https://panel.5-189-165-144.sslip.io/api-patrones/leer-factura-ia"

// Visibilidad cruzada de solo lectura (igual que las políticas de MinIO/RLS)
const VISIBILIDAD_CRUZADA = {
  laboratorio: ['logistica'],
  logistica: ['laboratorio'],
  comercial: ['laboratorio', 'logistica'],
  contabilidad: ['laboratorio', 'logistica', 'comercial'],
}

// Catálogo de condiciones de pago + etiqueta y días fijos correspondientes.
// 'personalizado' deja el campo de días editable a mano.
const CONDICIONES_PAGO = [
  { value: 'contado', label: 'Contado', dias: 0 },
  { value: 'credito_15', label: 'Crédito 15 días', dias: 15 },
  { value: 'credito_30', label: 'Crédito 30 días', dias: 30 },
  { value: 'credito_60', label: 'Crédito 60 días', dias: 60 },
  { value: 'personalizado', label: 'Personalizado', dias: null },
]

// Umbral de "por vencer": días antes del vencimiento a partir de los
// cuales se marca en amarillo en vez de neutro. Ajustable acá.
const DIAS_UMBRAL_POR_VENCER = 5

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

function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr + 'T00:00:00')
  d.setDate(d.getDate() + Number(dias || 0))
  return d.toISOString().split('T')[0]
}

function diasHasta(fechaStr) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const fecha = new Date(fechaStr + 'T00:00:00')
  return Math.round((fecha - hoy) / 86400000)
}

// Calcula el estado visual de la cobranza en base a la fecha de
// vencimiento y si ya se marcó como cobrada. No depende de la columna
// `estado` guardada para 'vencido'/'por_vencer' — siempre se recalcula
// contra la fecha de hoy, así el semáforo nunca queda desactualizado.
function calcularSemaforo(cobranza) {
  if (!cobranza) return null
  if (cobranza.estado === 'cobrado') {
    return { key: 'cobrado', label: '✅ Cobrado', color: '#4ade80' }
  }
  const dias = diasHasta(cobranza.fecha_vencimiento)
  if (dias < 0) {
    return { key: 'vencido', label: `⚠ Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`, color: '#f87171' }
  }
  if (dias <= DIAS_UMBRAL_POR_VENCER) {
    return { key: 'por_vencer', label: dias === 0 ? '⏰ Vence hoy' : `⏰ Vence en ${dias} día${dias !== 1 ? 's' : ''}`, color: '#facc15' }
  }
  return { key: 'pendiente', label: `Pendiente — vence en ${dias} días`, color: '#94a3b8' }
}

// Envuelve una promesa con un tope de tiempo — si algo se cuelga, esto
// garantiza que el usuario vea un error en vez de quedarse con el reloj
// de arena para siempre.
function conTimeout(promise, ms, mensaje) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(mensaje)), ms)),
  ])
}

// ── pdf.js cargado desde CDN (sin dependencia npm) — se usa solo para
// RENDERIZAR la página como imagen, no para extraer texto (las facturas
// de MetroMecánica no tienen texto seleccionable en el cuerpo, solo en
// el logo/pie de página — el contenido real es una imagen incrustada).
// El worker se descarga y se convierte en Blob de mismo origen para
// evitar que el navegador bloquee la creación del Worker cross-origin.
let pdfjsPromise = null
function cargarPdfJs() {
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    return Promise.resolve(window.pdfjsLib)
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
          script.onload = resolve
          script.onerror = () => reject(new Error('No se pudo cargar la librería de lectura de PDF'))
          document.head.appendChild(script)
        })
      }
      const workerResp = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js')
      if (!workerResp.ok) throw new Error('No se pudo descargar el worker de pdf.js')
      const workerCode = await workerResp.text()
      const blob = new Blob([workerCode], { type: 'application/javascript' })
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
      return window.pdfjsLib
    })()
  }
  return pdfjsPromise
}

// Renderiza la primera página del PDF como imagen PNG y devuelve solo el
// base64 (sin el prefijo "data:image/png;base64,"). Escala 2x para que
// el texto se lea nítido cuando Claude lo analice.
async function renderizarPrimeraPaginaComoImagen(file) {
  const pdfjsLib = await conTimeout(cargarPdfJs(), 15000, 'No se pudo iniciar el lector de PDF (tiempo de espera agotado).')
  const buf = await file.arrayBuffer()
  const pdf = await conTimeout(
    pdfjsLib.getDocument({ data: buf }).promise,
    20000,
    'El PDF tardó demasiado en procesarse. Intenta de nuevo.'
  )
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.split(',')[1]
}

// Manda la imagen de la factura al webhook de n8n, que la procesa con
// Claude (visión) y devuelve el JSON con los campos ya extraídos.
async function leerFacturaConIA(imagenBase64) {
  const resp = await conTimeout(
    fetch(WEBHOOK_URL_LEER_FACTURA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen_base64: imagenBase64 }),
    }),
    30000,
    'La lectura con IA tardó demasiado. Intenta de nuevo.'
  )
  if (!resp.ok) {
    throw new Error(`El servidor no pudo procesar la factura (código ${resp.status})`)
  }
  return await resp.json()
}

// A partir de los datos que devuelve la IA (numero_factura, ruc_cliente,
// fecha_emision, fecha_vencimiento, forma_pago, monto_total,
// monto_detraccion, numero_cuenta_detraccion), deduce la condición de
// pago y los días de crédito comparando las dos fechas — igual criterio
// que antes, pero ahora las fechas vienen de un modelo con visión en vez
// de un regex sobre texto que no existía.
function deducirCondicionPago(datos) {
  let dias_credito = 0
  if (datos.fecha_emision && datos.fecha_vencimiento) {
    dias_credito = Math.round((new Date(datos.fecha_vencimiento) - new Date(datos.fecha_emision)) / 86400000)
  }
  let condicion_pago = 'personalizado'
  if (datos.forma_pago === 'contado' || dias_credito === 0) condicion_pago = 'contado'
  else if ([15, 30, 60].includes(dias_credito)) condicion_pago = `credito_${dias_credito}`
  return { dias_credito, condicion_pago }
}

// CSS del layout de dos columnas — con media query para colapsar a una
// sola columna en pantallas angostas (tablet/mobile). Se define aquí,
// scoped por nombre de clase, para no tocar index.css global.
const LayoutCSS = () => (
  <style>{`
    .otdetail-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 380px;
      gap: 20px;
      align-items: start;
    }
    .otdetail-sidebar {
      position: sticky;
      top: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .otdetail-section-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--ocean-accent);
      margin-bottom: 10px;
    }
    .cobranza-dropzone {
      padding: 36px 20px;
      margin-bottom: 0;
      min-height: 110px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cobranza-dropzone .dropzone-text {
      font-size: 14px;
      text-align: center;
    }
    @media (max-width: 900px) {
      .otdetail-grid { grid-template-columns: 1fr; }
      .otdetail-sidebar { position: static; top: auto; }
    }
  `}</style>
)

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

// Modal de diagnóstico: muestra el JSON crudo que devolvió la IA — útil
// si algún campo sale mal, para ver exactamente qué entendió el modelo.
function JsonDebugModal({ datos, onClose }) {
  const texto = JSON.stringify(datos, null, 2)
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

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
          background: 'var(--panel-bg, #0f172a)', borderRadius: 12, width: '100%', maxWidth: 600,
          maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 14 }}>Datos extraídos por la IA (diagnóstico)</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={copiar}>
              {copiado ? '✓ Copiado' : '📋 Copiar'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={onClose}>✕ Cerrar</button>
          </div>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'monospace', color: 'var(--text-light)', margin: 0 }}>
            {texto}
          </pre>
        </div>
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

function formatFechaObs(fechaIso) {
  return new Date(fechaIso).toLocaleString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── Card de solo lectura: Equipos Ingresados ──
function EquiposIngresadosCard({ ingresos }) {
  if (!ingresos || ingresos.length === 0) {
    return (
      <div className="card">
        <div className="otdetail-section-label">📦 Equipos Ingresados</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Aún no hay equipos registrados en Ingresos para esta OT. Este registro se hace desde MetroTrack.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="otdetail-section-label">📦 Equipos Ingresados — {ingresos.length} equipo{ingresos.length !== 1 ? 's' : ''}</div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: -4, marginBottom: 14 }}>
        Datos jalados desde MetroTrack (pestaña Ingresos). Solo lectura aquí — para editar, hazlo en MetroTrack.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {ingresos.map((eq, i) => (
          <div
            key={eq.id || i}
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{eq.descripcion || `Equipo #${i + 1}`}</strong>
              {eq.nro_guia && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {eq.nro_guia}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--text-muted)' }}>
              {eq.marca && <span><b>Marca:</b> {eq.marca}</span>}
              {eq.modelo && <span><b>Modelo:</b> {eq.modelo}</span>}
              {eq.nro_serie && <span><b>N° Serie:</b> {eq.nro_serie}</span>}
              {eq.id_equipo && <span><b>ID:</b> {eq.id_equipo}</span>}
              {eq.fecha_ingreso && <span><b>Ingreso:</b> {eq.fecha_ingreso}</span>}
              {eq.codigo_certificado && <span><b>Cert.:</b> {eq.codigo_certificado}</span>}
              {eq.datos_adicionales && <span style={{ fontStyle: 'italic' }}>{eq.datos_adicionales}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Dropzone de la factura PDF: arrastrar y soltar, o clic para seleccionar ──
function FacturaDropzone({ onFile, leyendo }) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const fileRef = useRef(null)

  function handleDragEnter(e) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true)
  }
  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }
  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }
  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      className={`dropzone cobranza-dropzone${isDragging ? ' dropzone-dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !leyendo && fileRef.current?.click()}
      style={{ cursor: leyendo ? 'wait' : 'pointer' }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = '' }}
        style={{ display: 'none' }}
        disabled={leyendo}
      />
      <p className="dropzone-text">
        {leyendo ? '🤖 Leyendo factura con IA...' : '📎 Arrastra el PDF de la factura aquí, o haz clic para seleccionar'}
      </p>
    </div>
  )
}

// ── Card de Cobranza — solo en la pestaña de Contabilidad ──
function CobranzaCard({ otNumber, rucOT, puedeEditar, profile }) {
  const [cobranza, setCobranza] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [leyendoPDF, setLeyendoPDF] = useState(false)
  const [avisoRuc, setAvisoRuc] = useState(null)
  const [datosIA, setDatosIA] = useState(null)
  const [mostrarDebug, setMostrarDebug] = useState(false)
  const [form, setForm] = useState({
    numero_factura: '',
    fecha_emision: new Date().toISOString().split('T')[0],
    condicion_pago: 'contado',
    dias_credito: 0,
    monto: '',
    monto_detraccion: '',
    numero_cuenta_detraccion: '',
    cliente_correo: '',
    cliente_telefono: '',
  })

  async function cargarCobranza() {
    setCargando(true)
    const { data, error } = await supabase
      .from('cobranza')
      .select('*')
      .eq('ot_number', otNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) {
      setCobranza(data)
      setForm({
        numero_factura: data.numero_factura || '',
        fecha_emision: data.fecha_emision || new Date().toISOString().split('T')[0],
        condicion_pago: data.condicion_pago || 'contado',
        dias_credito: data.dias_credito ?? 0,
        monto: data.monto ?? '',
        monto_detraccion: data.monto_detraccion ?? '',
        numero_cuenta_detraccion: data.numero_cuenta_detraccion || '',
        cliente_correo: data.cliente_correo || '',
        cliente_telefono: data.cliente_telefono || '',
      })
    } else {
      setCobranza(null)
    }
    setCargando(false)
  }

  useEffect(() => {
    cargarCobranza()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otNumber])

  function set(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  function onChangeCondicion(value) {
    const cfg = CONDICIONES_PAGO.find((c) => c.value === value)
    setForm((prev) => ({
      ...prev,
      condicion_pago: value,
      dias_credito: cfg?.dias ?? prev.dias_credito,
    }))
  }

  async function handleArchivoPDF(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Solo se aceptan archivos PDF.')
      return
    }
    setLeyendoPDF(true)
    setAvisoRuc(null)
    setDatosIA(null)
    try {
      const imagenBase64 = await renderizarPrimeraPaginaComoImagen(file)
      const datos = await leerFacturaConIA(imagenBase64)
      setDatosIA(datos)

      if (!datos.numero_factura && !datos.fecha_emision && !datos.monto_total) {
        setMostrarDebug(true)
      }

      if (datos.ruc_cliente && rucOT && datos.ruc_cliente !== rucOT) {
        setAvisoRuc(`⚠ El RUC de la factura (${datos.ruc_cliente}) no coincide con el RUC de la OT (${rucOT}). Verifica que sea el PDF correcto.`)
      }

      const { dias_credito, condicion_pago } = deducirCondicionPago(datos)

      setForm((prev) => ({
        ...prev,
        numero_factura: datos.numero_factura || prev.numero_factura,
        fecha_emision: datos.fecha_emision || prev.fecha_emision,
        condicion_pago: condicion_pago || prev.condicion_pago,
        dias_credito: dias_credito ?? prev.dias_credito,
        monto: datos.monto_total ?? prev.monto,
        monto_detraccion: datos.monto_detraccion ?? prev.monto_detraccion,
        numero_cuenta_detraccion: datos.numero_cuenta_detraccion || prev.numero_cuenta_detraccion,
      }))
      setEditando(true)
    } catch (err) {
      console.error('Error leyendo factura con IA:', err)
      alert('No se pudo leer la factura: ' + err.message)
    }
    setLeyendoPDF(false)
  }

  async function guardar() {
    if (!form.numero_factura.trim()) {
      alert('El número de factura es obligatorio.')
      return
    }
    setGuardando(true)
    const fecha_vencimiento = sumarDias(form.fecha_emision, form.dias_credito)
    const payload = {
      ot_number: otNumber,
      numero_factura: form.numero_factura.trim(),
      fecha_emision: form.fecha_emision,
      condicion_pago: form.condicion_pago,
      dias_credito: Number(form.dias_credito) || 0,
      fecha_vencimiento,
      monto: form.monto === '' ? null : Number(form.monto),
      monto_detraccion: form.monto_detraccion === '' ? null : Number(form.monto_detraccion),
      numero_cuenta_detraccion: form.numero_cuenta_detraccion.trim() || null,
      cliente_correo: form.cliente_correo.trim() || null,
      cliente_telefono: form.cliente_telefono.trim() || null,
    }

    let error
    if (cobranza?.id) {
      ({ error } = await supabase.from('cobranza').update(payload).eq('id', cobranza.id))
    } else {
      ({ error } = await supabase.from('cobranza').insert({ ...payload, creado_por: profile.id, estado: 'pendiente' }))
    }

    if (error) {
      alert('No se pudo guardar la cobranza: ' + error.message)
    } else {
      registrarAuditoria(profile.id, 'registrar_cobranza', otNumber, `Factura ${payload.numero_factura}`)
      setEditando(false)
      setAvisoRuc(null)
      cargarCobranza()
    }
    setGuardando(false)
  }

  async function marcarCobrado() {
    if (!cobranza?.id) return
    if (!confirm(`¿Confirmas que la factura ${cobranza.numero_factura} ya fue cobrada?`)) return
    const { error } = await supabase
      .from('cobranza')
      .update({ estado: 'cobrado', fecha_cobro: new Date().toISOString().split('T')[0] })
      .eq('id', cobranza.id)
    if (error) {
      alert('No se pudo actualizar: ' + error.message)
    } else {
      registrarAuditoria(profile.id, 'marcar_cobrado', otNumber, `Factura ${cobranza.numero_factura}`)
      cargarCobranza()
    }
  }

  const semaforo = calcularSemaforo(cobranza)
  const esPersonalizado = form.condicion_pago === 'personalizado'
  const montoACobrar = cobranza?.monto != null
    ? Number(cobranza.monto) - Number(cobranza.monto_detraccion || 0)
    : null

  if (cargando) {
    return (
      <div className="card">
        <div className="otdetail-section-label">💰 Cobranza</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Cargando...</p>
      </div>
    )
  }

  if (!cobranza && !puedeEditar) {
    return (
      <div className="card">
        <div className="otdetail-section-label">💰 Cobranza</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Aún no se ha registrado factura para esta OT.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="otdetail-section-label" style={{ margin: 0 }}>💰 Cobranza</div>
        {cobranza && semaforo && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: semaforo.color,
              background: `${semaforo.color}22`,
              borderRadius: 20,
              padding: '3px 12px',
            }}
          >
            {semaforo.label}
          </span>
        )}
      </div>

      {puedeEditar && (
        <div style={{ marginBottom: 8 }}>
          <FacturaDropzone onFile={handleArchivoPDF} leyendo={leyendoPDF} />
        </div>
      )}

      {datosIA && (
        <div style={{ marginBottom: 14 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setMostrarDebug(true)}
          >
            🔍 Ver datos extraídos por la IA
          </button>
        </div>
      )}

      {avisoRuc && (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>
          {avisoRuc}
        </div>
      )}

      {cobranza && !editando && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginBottom: puedeEditar ? 14 : 0 }}>
          <div><b>N° Factura:</b> {cobranza.numero_factura}</div>
          <div><b>Emisión:</b> {cobranza.fecha_emision} · <b>Vencimiento:</b> {cobranza.fecha_vencimiento}</div>
          <div>
            <b>Condición:</b> {CONDICIONES_PAGO.find((c) => c.value === cobranza.condicion_pago)?.label || cobranza.condicion_pago}
            {cobranza.condicion_pago === 'personalizado' && ` (${cobranza.dias_credito} días)`}
          </div>
          {cobranza.monto != null && <div><b>Monto factura:</b> S/ {Number(cobranza.monto).toFixed(2)}</div>}
          {cobranza.monto_detraccion != null && (
            <div style={{ color: 'var(--text-muted)' }}>
              <b>Detracción:</b> S/ {Number(cobranza.monto_detraccion).toFixed(2)}
              {cobranza.numero_cuenta_detraccion && ` · Cta: ${cobranza.numero_cuenta_detraccion}`}
            </div>
          )}
          {montoACobrar != null && (
            <div style={{ fontWeight: 700, color: 'var(--ocean-accent)' }}>Monto a cobrar: S/ {montoACobrar.toFixed(2)}</div>
          )}
          {cobranza.estado === 'cobrado' && cobranza.fecha_cobro && (
            <div style={{ color: '#4ade80' }}><b>Cobrado el:</b> {cobranza.fecha_cobro}</div>
          )}
          {(cobranza.cliente_correo || cobranza.cliente_telefono) && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Contacto: {cobranza.cliente_correo || '—'} {cobranza.cliente_telefono ? `· ${cobranza.cliente_telefono}` : ''}
            </div>
          )}

          {puedeEditar && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setEditando(true)}>
                Editar
              </button>
              {cobranza.estado !== 'cobrado' && (
                <button className="btn" style={{ fontSize: 12, padding: '6px 12px' }} onClick={marcarCobrado}>
                  ✓ Marcar como cobrado
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {puedeEditar && (editando || !cobranza) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label>N° Factura</label>
            <input value={form.numero_factura} onChange={(e) => set('numero_factura', e.target.value)} placeholder="F001-00123" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Fecha de emisión</label>
              <input type="date" value={form.fecha_emision} onChange={(e) => set('fecha_emision', e.target.value)} />
            </div>
            <div>
              <label>Monto factura (S/)</label>
              <input type="number" step="0.01" value={form.monto} onChange={(e) => set('monto', e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: esPersonalizado ? '1fr 1fr' : '1fr', gap: 10 }}>
            <div>
              <label>Condición de pago</label>
              <select value={form.condicion_pago} onChange={(e) => onChangeCondicion(e.target.value)}>
                {CONDICIONES_PAGO.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {esPersonalizado && (
              <div>
                <label>Días de crédito</label>
                <input type="number" min="0" value={form.dias_credito} onChange={(e) => set('dias_credito', e.target.value)} />
              </div>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
            Vencimiento calculado: <b>{sumarDias(form.fecha_emision, form.dias_credito)}</b>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Monto detracción (S/, opcional)</label>
              <input type="number" step="0.01" value={form.monto_detraccion} onChange={(e) => set('monto_detraccion', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label>Cuenta detracción (opcional)</label>
              <input value={form.numero_cuenta_detraccion} onChange={(e) => set('numero_cuenta_detraccion', e.target.value)} placeholder="00-014-XXXXXX" />
            </div>
          </div>
          {form.monto && form.monto_detraccion && (
            <p style={{ fontSize: 12, color: 'var(--ocean-accent)', margin: 0, fontWeight: 600 }}>
              Monto a cobrar: S/ {(Number(form.monto) - Number(form.monto_detraccion)).toFixed(2)}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Correo del cliente (para recordatorio)</label>
              <input value={form.cliente_correo} onChange={(e) => set('cliente_correo', e.target.value)} placeholder="cliente@empresa.com" />
            </div>
            <div>
              <label>Teléfono del cliente (WhatsApp)</label>
              <input value={form.cliente_telefono} onChange={(e) => set('cliente_telefono', e.target.value)} placeholder="+51 9XX XXX XXX" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : cobranza ? 'Guardar cambios' : 'Registrar factura'}
            </button>
            {cobranza && (
              <button className="btn btn-secondary" onClick={() => { setEditando(false); setAvisoRuc(null) }}>Cancelar</button>
            )}
          </div>
        </div>
      )}

      {mostrarDebug && datosIA && (
        <JsonDebugModal datos={datosIA} onClose={() => setMostrarDebug(false)} />
      )}
    </div>
  )
}

export default function OTDetail({ profile }) {
  const { otNumber } = useParams()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [documentos, setDocumentos] = useState([])
  const [activeArea, setActiveArea] = useState(profile.area === 'gerencia' ? 'laboratorio' : profile.area)
  const [abriendoId, setAbriendoId] = useState(null)
  const [visor, setVisor] = useState(null)
  const [noLeidosPorArea, setNoLeidosPorArea] = useState({})

  const [observaciones, setObservaciones] = useState([])
  const [nuevaObs, setNuevaObs] = useState('')
  const [guardandoObs, setGuardandoObs] = useState(false)
  const [resumenObs, setResumenObs] = useState([])

  const esGerencia = profile.area === 'gerencia'

  const areasVisibles = esGerencia
    ? TODAS_LAS_AREAS
    : [profile.area, ...(VISIBILIDAD_CRUZADA[profile.area] || [])]

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

  useEffect(() => {
    if (!profile?.id || !otNumber) return
    registrarAuditoria(profile.id, 'ver', otNumber, `Área vista: ${activeArea}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otNumber, activeArea, profile?.id])

  async function loadDocumentos() {
    const { data } = await supabase
      .from('documentos')
      .select('*')
      .eq('ot_number', otNumber)
      .eq('area', activeArea)
      .order('created_at', { ascending: false })

    const docs = data || []

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

  async function loadObservaciones() {
    const { data, error } = await supabase
      .from('observaciones_ot')
      .select('*')
      .eq('ot_number', otNumber)
      .eq('area', activeArea)
      .order('created_at', { ascending: false })
    if (!error) setObservaciones(data || [])
  }

  useEffect(() => {
    loadObservaciones()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArea, otNumber])

  async function loadResumenObservaciones() {
    const { data, error } = await supabase
      .from('observaciones_ot')
      .select('*')
      .eq('ot_number', otNumber)
      .order('created_at', { ascending: false })
    if (!error) setResumenObs(data || [])
  }

  useEffect(() => {
    loadResumenObservaciones()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otNumber])

  async function agregarObservacion() {
    const texto = nuevaObs.trim()
    if (!texto) return
    setGuardandoObs(true)
    const { error } = await supabase.from('observaciones_ot').insert({
      ot_number: otNumber,
      area: activeArea,
      usuario_id: profile.id,
      usuario_nombre: profile.full_name || null,
      texto,
    })
    if (error) {
      alert('No se pudo guardar la observación: ' + error.message)
    } else {
      setNuevaObs('')
      registrarAuditoria(profile.id, 'agregar_observacion', otNumber, `Área: ${activeArea}`)
      loadObservaciones()
      loadResumenObservaciones()
    }
    setGuardandoObs(false)
  }

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

  async function marcarLeidoArea(area) {
    if (!noLeidosPorArea[area]) return
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

  useEffect(() => {
    marcarLeidoArea(activeArea)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArea, otNumber])

  function handleUploaded() {
    registrarAuditoria(profile.id, 'subir', otNumber, `Área: ${activeArea}`)
    loadDocumentos()
  }

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

  function verDocumentoOT() {
    if (!service?.ot_file_url) return
    registrarAuditoria(profile.id, 'ver_documento_ot', otNumber, 'Word original de la OT')
    setVisor({ titulo: `${otNumber} — Documento original`, url: service.ot_file_url, extension: 'docx' })
  }

  const configArea = AREAS_CONFIG[activeArea]

  return (
    <div className="container container-ancho" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <LayoutCSS />

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
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
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

      <div className="otdetail-grid">
        <div>
          <h3 style={{ marginTop: 0 }}>{configArea.label}</h3>

          {activeArea === 'logistica' && (
            <EquiposIngresadosCard ingresos={service?.ingresos} />
          )}

          {activeArea === 'contabilidad' && (
            <CobranzaCard
              otNumber={otNumber}
              rucOT={service?.ruc}
              puedeEditar={puedeSubir}
              profile={profile}
            />
          )}

          {puedeSubir ? (
            <UploadForm
              otNumber={otNumber}
              area={activeArea}
              tipos={configArea.tipos}
              userId={profile.id}
              documentosExistentes={documentos}
              onUploaded={handleUploaded}
            />
          ) : (
            <div className="card">
              <p style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic', margin: 0 }}>
                Solo lectura — esta área no te pertenece.
              </p>
            </div>
          )}

          <div className="card">
            <div className="otdetail-section-label">Documentos subidos</div>
            {documentos.length === 0 && <p style={{ color: 'var(--text-muted)', margin: 0 }}>Aún no hay documentos en esta área.</p>}
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
        </div>

        <div className="otdetail-sidebar">
          <div className="card">
            <div className="otdetail-section-label">Observaciones — {configArea.label}</div>

            {puedeSubir && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                <textarea
                  value={nuevaObs}
                  onChange={(e) => setNuevaObs(e.target.value)}
                  placeholder={`Observación de ${configArea.label} sobre este servicio...`}
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
                <button
                  className="btn"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={guardandoObs || !nuevaObs.trim()}
                  onClick={agregarObservacion}
                >
                  {guardandoObs ? 'Guardando...' : '+ Agregar observación'}
                </button>
              </div>
            )}

            {observaciones.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Aún no hay observaciones de esta área.</p>
            )}
            {observaciones.map((o) => (
              <div key={o.id} className="doc-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <div style={{ fontSize: 13 }}>{o.texto}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {o.usuario_nombre || '—'} · {formatFechaObs(o.created_at)}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="otdetail-section-label">Resumen — todas las áreas</div>
            {resumenObs.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Aún no hay observaciones registradas por ninguna área.</p>
            )}
            {resumenObs.map((o) => (
              <div key={o.id} className="doc-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--ocean-accent)',
                    background: 'rgba(45,212,191,0.12)',
                    borderRadius: 6,
                    padding: '2px 8px',
                  }}
                >
                  {AREAS_CONFIG[o.area]?.label || o.area}
                </span>
                <div style={{ fontSize: 13 }}>{o.texto}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {o.usuario_nombre || '—'} · {formatFechaObs(o.created_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
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