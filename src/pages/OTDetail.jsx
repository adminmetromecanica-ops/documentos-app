import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { AREAS_CONFIG, TODAS_LAS_AREAS } from '../lib/areasConfig'
import UploadForm from '../components/UploadForm'

const WEBHOOK_URL_DOCUMENTO = "https://panel.5-189-165-144.sslip.io/api-patrones/url-documento"
const WEBHOOK_URL_LEER_FACTURA = "https://panel.5-189-165-144.sslip.io/api-patrones/leer-factura-ia"
const WEBHOOK_SUBIR_DOCUMENTO = "https://panel.5-189-165-144.sslip.io/api-patrones/subir-documento"

// Visibilidad cruzada de solo lectura (igual que las políticas de MinIO/RLS)
const VISIBILIDAD_CRUZADA = {
  laboratorio: ['logistica'],
  logistica: ['laboratorio'],
  comercial: ['laboratorio', 'logistica'],
  contabilidad: ['laboratorio', 'logistica', 'comercial'],
}

// Catálogo de condiciones de pago + etiqueta y días fijos correspondientes.
const CONDICIONES_PAGO = [
  { value: 'contado', label: 'Contado', dias: 0 },
  { value: 'credito_15', label: 'Crédito 15 días', dias: 15 },
  { value: 'credito_30', label: 'Crédito 30 días', dias: 30 },
  { value: 'credito_60', label: 'Crédito 60 días', dias: 60 },
  { value: 'personalizado', label: 'Personalizado', dias: null },
]

const DIAS_UMBRAL_POR_VENCER = 5

// ── Regla de detracción automática (rescatada de FACTUTRACK PRO) ──────────
// Cód. 037 — Otros Servicios Empresariales — Detracción 12% cuando el monto
// total supera S/ 700.00. Solo se sugiere si el usuario/IA/XML no trajo ya
// un valor de detracción; siempre queda editable antes de guardar.
const DETRACCION_UMBRAL_MONTO = 700
const DETRACCION_PORCENTAJE_DEFECTO = 12

function sugerirDetraccion(datos) {
  const monto = Number(datos.monto_total)
  const moneda = datos.moneda || 'PEN'
  const yaTieneDetraccion = datos.porcentaje_detraccion != null || datos.monto_detraccion != null
  if (yaTieneDetraccion || !monto || moneda !== 'PEN' || monto <= DETRACCION_UMBRAL_MONTO) {
    return { ...datos, _detraccionSugerida: false }
  }
  return {
    ...datos,
    porcentaje_detraccion: DETRACCION_PORCENTAJE_DEFECTO,
    monto_detraccion: Number((monto * DETRACCION_PORCENTAJE_DEFECTO / 100).toFixed(2)),
    _detraccionSugerida: true,
  }
}

// Íconos por tipo de documento (ajusta o agrega según tus tipos reales)
const ICONOS_TIPO_DOCUMENTO = {
  'Certificado': '📜',
  'Informe': '📊',
  'Acta de Conformidad': '✅',
  'Factura': '🧾',
  'Factura XML': '🗂',
  'Guía de Remisión': '🚚',
  'Orden de Compra': '🛒',
  'Cotización': '💵',
  'Contrato': '📑',
  'Ficha OT': '🗂',
  'Sin clasificar': '📄',
}
function iconoTipoDocumento(tipo) {
  return ICONOS_TIPO_DOCUMENTO[tipo] || '📄'
}

// Agrupa documentos por tipo_documento y ordena por cantidad descendente
function agruparDocumentosPorTipo(documentos) {
  const grupos = {}
  for (const doc of documentos) {
    const tipo = doc.tipo_documento || 'Sin clasificar'
    if (!grupos[tipo]) grupos[tipo] = []
    grupos[tipo].push(doc)
  }
  return Object.entries(grupos)
    .map(([tipo, docs]) => ({ tipo, docs }))
    .sort((a, b) => b.docs.length - a.docs.length)
}

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

function conTimeout(promise, ms, mensaje) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(mensaje)), ms)),
  ])
}

// Normaliza un nombre de cliente para comparación tolerante.
function normalizarNombre(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nombresParecidos(a, b) {
  const na = normalizarNombre(a)
  const nb = normalizarNombre(b)
  if (!na || !nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  return na.split(' ')[0] === nb.split(' ')[0]
}

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

// ── Parser de XML SUNAT (UBL 2.1) — rescatado de FACTUTRACK PRO ───────────
// Lee directamente los campos estructurados de la factura electrónica, sin
// usar IA: gratis, instantáneo y 100% exacto (a diferencia de leer la
// imagen del PDF). Solo cubre los campos que el estándar UBL garantiza;
// todo lo demás (detracción, glosa) se deja para revisión manual o para el
// merge con lo que ya haya traído la IA si también se subió el PDF.
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'

function textoDirecto(elemento, ns, localName) {
  if (!elemento) return ''
  const hijo = Array.from(elemento.children).find((el) => el.localName === localName && el.namespaceURI === ns)
  return hijo ? hijo.textContent.trim() : ''
}

function primerPorTagNS(root, ns, localName) {
  const els = root.getElementsByTagNameNS(ns, localName)
  return els.length > 0 ? els[0] : null
}

function parsearXMLFactura(xmlTexto) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlTexto, 'application/xml')
  const errorParseo = doc.querySelector('parsererror')
  if (errorParseo) {
    throw new Error('El archivo no es un XML válido.')
  }
  const root = doc.documentElement

  const numero_factura = textoDirecto(root, NS_CBC, 'ID')
  const moneda = textoDirecto(root, NS_CBC, 'DocumentCurrencyCode') || 'PEN'
  const fecha_emision_raw = textoDirecto(root, NS_CBC, 'IssueDate')
  const fecha_emision = fecha_emision_raw || null
  const fecha_vencimiento_raw = textoDirecto(root, NS_CBC, 'DueDate')

  const supplierParty = primerPorTagNS(root, NS_CAC, 'AccountingSupplierParty')
  const supplierPartyIdentification = supplierParty ? primerPorTagNS(supplierParty, NS_CAC, 'PartyIdentification') : null
  const ruc_emisor = supplierPartyIdentification ? textoDirecto(supplierPartyIdentification, NS_CBC, 'ID') : ''
  const supplierLegalEntity = supplierParty ? primerPorTagNS(supplierParty, NS_CAC, 'PartyLegalEntity') : null
  const razon_social_emisor = supplierLegalEntity ? textoDirecto(supplierLegalEntity, NS_CBC, 'RegistrationName') : ''

  const customerParty = primerPorTagNS(root, NS_CAC, 'AccountingCustomerParty')
  const customerPartyIdentification = customerParty ? primerPorTagNS(customerParty, NS_CAC, 'PartyIdentification') : null
  const ruc_cliente = customerPartyIdentification ? textoDirecto(customerPartyIdentification, NS_CBC, 'ID') : ''
  const customerLegalEntity = customerParty ? primerPorTagNS(customerParty, NS_CAC, 'PartyLegalEntity') : null
  const cliente_nombre = customerLegalEntity ? textoDirecto(customerLegalEntity, NS_CBC, 'RegistrationName') : ''

  const legalMonetaryTotal = primerPorTagNS(root, NS_CAC, 'LegalMonetaryTotal')
  const valor_venta_raw = legalMonetaryTotal ? textoDirecto(legalMonetaryTotal, NS_CBC, 'LineExtensionAmount') : ''
  const monto_total_raw = legalMonetaryTotal
    ? (textoDirecto(legalMonetaryTotal, NS_CBC, 'PayableAmount') || textoDirecto(legalMonetaryTotal, NS_CBC, 'TaxInclusiveAmount'))
    : ''

  const taxTotal = primerPorTagNS(root, NS_CAC, 'TaxTotal')
  const igv_raw = taxTotal ? textoDirecto(taxTotal, NS_CBC, 'TaxAmount') : ''

  const orderReference = primerPorTagNS(root, NS_CAC, 'OrderReference')
  const referencia_oc = orderReference ? textoDirecto(orderReference, NS_CBC, 'ID') : ''

  const paymentTerms = primerPorTagNS(root, NS_CAC, 'PaymentTerms')
  const paymentMeansId = paymentTerms ? textoDirecto(paymentTerms, NS_CBC, 'PaymentMeansID') : ''
  let forma_pago = 'contado'
  if (/credit/i.test(paymentMeansId)) forma_pago = 'credito'
  else if (fecha_vencimiento_raw && fecha_emision_raw && fecha_vencimiento_raw !== fecha_emision_raw) forma_pago = 'credito'

  const primeraLinea = primerPorTagNS(root, NS_CAC, 'InvoiceLine')
  const item = primeraLinea ? primerPorTagNS(primeraLinea, NS_CAC, 'Item') : null
  const glosa = item ? textoDirecto(item, NS_CBC, 'Description') : ''

  return {
    numero_factura: numero_factura || null,
    fecha_emision: fecha_emision || null,
    fecha_vencimiento: fecha_vencimiento_raw || fecha_emision || null,
    forma_pago,
    dias_credito: null,
    moneda,
    ruc_emisor: ruc_emisor || null,
    razon_social_emisor: razon_social_emisor || null,
    ruc_cliente: ruc_cliente || null,
    cliente_nombre: cliente_nombre || null,
    direccion_cliente: null,
    referencia_oc: referencia_oc || null,
    guia_remision: null,
    valor_venta: valor_venta_raw ? Number(valor_venta_raw) : null,
    igv: igv_raw ? Number(igv_raw) : null,
    monto_total: monto_total_raw ? Number(monto_total_raw) : null,
    porcentaje_detraccion: null,
    monto_detraccion: null,
    numero_cuenta_detraccion: null,
    codigo_bien_servicio_detraccion: null,
    glosa: glosa ? glosa.slice(0, 200) : null,
    observaciones: null,
  }
}

function deducirCondicionPago(datos) {
  let dias_credito = 0
  if (datos.fecha_emision && datos.fecha_vencimiento) {
    dias_credito = Math.round((new Date(datos.fecha_vencimiento) - new Date(datos.fecha_emision)) / 86400000)
  } else if (datos.dias_credito != null) {
    dias_credito = Number(datos.dias_credito) || 0
  }
  let condicion_pago = 'personalizado'
  if (datos.forma_pago === 'contado' || dias_credito === 0) condicion_pago = 'contado'
  else if ([15, 30, 60].includes(dias_credito)) condicion_pago = `credito_${dias_credito}`
  return { dias_credito, condicion_pago }
}

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
    .cobranza-dropzone.compacta {
      padding: 16px 20px;
      min-height: 50px;
    }
    .cobranza-dropzone .dropzone-text {
      font-size: 14px;
      text-align: center;
    }
    .cobranza-dropzone.compacta .dropzone-text {
      font-size: 12.5px;
    }
    .cobranza-subtitle {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin: 4px 0 2px;
    }
    /* ── Paneles de método de captura de factura (IA vs XML) ──────────── */
    /* Antes eran dos dropzones apiladas que se confundían entre sí (una se
       veía como continuación de la otra). Ahora son dos paneles grandes,
       con color, ícono y borde propios — imposible soltar el archivo en el
       panel equivocado sin notarlo. */
    .factura-metodos-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    @media (max-width: 720px) {
      .factura-metodos-grid { grid-template-columns: 1fr; }
      .factura-metodo-divider { flex-direction: row; height: auto; padding: 4px 0; }
      .factura-metodo-divider::before, .factura-metodo-divider::after { width: 100%; height: 1px; }
    }
    .factura-metodo-divider {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1px;
    }
    .factura-metodo-divider::before, .factura-metodo-divider::after {
      content: '';
      width: 1px;
      flex: 1;
      background: var(--border);
    }
    .factura-metodo-panel {
      border-radius: 16px;
      padding: 22px;
      border: 2px solid;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .factura-metodo-panel.metodo-ia {
      border-color: rgba(45,212,191,0.45);
      background: linear-gradient(180deg, rgba(45,212,191,0.08), rgba(45,212,191,0.02));
    }
    .factura-metodo-panel.metodo-xml {
      border-color: rgba(167,139,250,0.45);
      background: linear-gradient(180deg, rgba(167,139,250,0.08), rgba(167,139,250,0.02));
    }
    .factura-metodo-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .factura-metodo-icon {
      font-size: 30px;
      line-height: 1;
      flex-shrink: 0;
    }
    .factura-metodo-titulo {
      font-size: 16px;
      font-weight: 800;
      color: var(--text-light, #e2e8f0);
    }
    .factura-metodo-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 9px;
      border-radius: 999px;
      margin-top: 3px;
    }
    .metodo-ia .factura-metodo-badge { background: rgba(45,212,191,0.18); color: var(--ocean-accent); }
    .metodo-xml .factura-metodo-badge { background: rgba(167,139,250,0.18); color: #a78bfa; }
    .factura-metodo-panel .cobranza-dropzone {
      min-height: 130px;
      padding: 28px 16px;
      border-width: 2px;
      border-radius: 12px;
    }
    .metodo-ia .cobranza-dropzone { border-color: rgba(45,212,191,0.5); }
    .metodo-xml .cobranza-dropzone { border-color: rgba(167,139,250,0.5); }
    .factura-metodo-nota {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.4;
    }
    .doc-groups {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .doc-group {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(255,255,255,0.015);
    }
    .doc-group-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(45,212,191,0.06);
      border: none;
      cursor: pointer;
      color: var(--text-light, #e2e8f0);
      font-family: inherit;
      transition: background 0.15s ease;
    }
    .doc-group-header:hover {
      background: rgba(45,212,191,0.12);
    }
    .doc-group-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .doc-group-chevron {
      font-size: 10px;
      color: var(--ocean-accent);
      transition: transform 0.2s ease;
      display: inline-block;
    }
    .doc-group-icon {
      font-size: 15px;
    }
    .doc-group-title {
      font-size: 13px;
      font-weight: 600;
    }
    .doc-group-badge {
      font-size: 11px;
      font-weight: 700;
      background: var(--ocean-accent);
      color: #06251f;
      border-radius: 999px;
      padding: 2px 10px;
      min-width: 22px;
      text-align: center;
    }
    .doc-group-body {
      display: grid;
      transition: grid-template-rows 0.25s ease;
    }
    .doc-group-body-inner {
      overflow: hidden;
      padding: 0 12px;
    }
    .doc-group-body-inner .doc-item {
      padding: 10px 4px;
      border-bottom: 1px solid var(--border);
    }
    .doc-group-body-inner .doc-item:last-child {
      border-bottom: none;
    }
    @media (max-width: 900px) {
      .otdetail-grid { grid-template-columns: 1fr; }
      .otdetail-sidebar { position: static; top: auto; }
    }
  `}</style>
)

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
          <strong style={{ fontSize: 14 }}>Datos extraídos (diagnóstico)</strong>
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

// Lista de documentos agrupada por tipo, con contador y colapso/expansión
function DocumentosPorTipo({ documentos, abriendoId, onVer }) {
  const grupos = agruparDocumentosPorTipo(documentos)
  const [expandido, setExpandido] = useState(() => {
    const inicial = {}
    grupos.forEach((g, i) => { inicial[g.tipo] = i === 0 })
    return inicial
  })

  useEffect(() => {
    const gruposActuales = agruparDocumentosPorTipo(documentos)
    setExpandido((prev) => {
      const nuevo = {}
      gruposActuales.forEach((g, i) => {
        nuevo[g.tipo] = g.tipo in prev ? prev[g.tipo] : i === 0
      })
      return nuevo
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentos])

  function toggle(tipo) {
    setExpandido((prev) => ({ ...prev, [tipo]: !prev[tipo] }))
  }

  if (grupos.length === 0) {
    return <p style={{ color: 'var(--text-muted)', margin: 0 }}>Aún no hay documentos en esta área.</p>
  }

  return (
    <div className="doc-groups">
      {grupos.map((g) => (
        <div key={g.tipo} className="doc-group">
          <button className="doc-group-header" onClick={() => toggle(g.tipo)}>
            <span className="doc-group-header-left">
              <span
                className="doc-group-chevron"
                style={{ transform: expandido[g.tipo] ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ▶
              </span>
              <span className="doc-group-icon">{iconoTipoDocumento(g.tipo)}</span>
              <span className="doc-group-title">{g.tipo}</span>
            </span>
            <span className="doc-group-badge">{g.docs.length}</span>
          </button>
          <div
            className="doc-group-body"
            style={{ gridTemplateRows: expandido[g.tipo] ? '1fr' : '0fr' }}
          >
            <div className="doc-group-body-inner">
              {g.docs.map((d) => (
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
                    onClick={() => onVer(d)}
                  >
                    {abriendoId === d.id ? '⏳ Abriendo...' : '👁 Ver'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

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

function FacturaDropzone({ onFile, leyendo, compacta, texto, accept }) {
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
      className={`dropzone cobranza-dropzone${compacta ? ' compacta' : ''}${isDragging ? ' dropzone-dragging' : ''}`}
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
        accept={accept || '.pdf'}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = '' }}
        style={{ display: 'none' }}
        disabled={leyendo}
      />
      <p className="dropzone-text">{texto}</p>
    </div>
  )
}

function CobranzaCard({ otNumber, rucOT, clienteOT, puedeEditar, profile, onDocumentoSubido }) {
  const [cobranza, setCobranza] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [leyendoPDF, setLeyendoPDF] = useState(false)
  const [leyendoXML, setLeyendoXML] = useState(false)
  const [avisos, setAvisos] = useState([])
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
    moneda: 'PEN',
    referencia_oc: '',
    cliente_correo: '',
    cliente_telefono: '',
    // ── Campos ampliados para seguimiento de facturación (Contabilidad) ──
    cliente_nombre: '',
    ruc_emisor: '',
    razon_social_emisor: '',
    ruc_cliente: '',
    direccion_cliente: '',
    guia_remision: '',
    valor_venta: '',
    igv: '',
    porcentaje_detraccion: '',
    codigo_bien_servicio_detraccion: '',
    glosa: '',
    observaciones: '',
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
        moneda: data.moneda || 'PEN',
        referencia_oc: data.referencia_oc || '',
        cliente_correo: data.cliente_correo || '',
        cliente_telefono: data.cliente_telefono || '',
        cliente_nombre: data.cliente_nombre || '',
        ruc_emisor: data.ruc_emisor || '',
        razon_social_emisor: data.razon_social_emisor || '',
        ruc_cliente: data.ruc_cliente || '',
        direccion_cliente: data.direccion_cliente || '',
        guia_remision: data.guia_remision || '',
        valor_venta: data.valor_venta ?? '',
        igv: data.igv ?? '',
        porcentaje_detraccion: data.porcentaje_detraccion ?? '',
        codigo_bien_servicio_detraccion: data.codigo_bien_servicio_detraccion || '',
        glosa: data.glosa || '',
        observaciones: data.observaciones || '',
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

  // ── Sube el archivo de factura (PDF o XML) como documento del área ──────
  // Contabilidad, en MinIO. Se usa tanto para el PDF como para el XML —
  // ambos quedan disponibles en "Documentos subidos" con su propio tipo.
  async function subirDocumentoFactura(file, tipoDocumento, subcarpeta) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const fd = new FormData()
      fd.append('file', file, file.name)
      fd.append('ot_number', otNumber)
      fd.append('area', 'contabilidad')
      fd.append('tipo_documento', tipoDocumento)
      fd.append('subcarpeta', subcarpeta)
      fd.append('nombre_archivo', file.name)
      fd.append('subido_por', user?.id || profile?.id || '')

      const resp = await fetch(WEBHOOK_SUBIR_DOCUMENTO, { method: 'POST', body: fd })
      if (!resp.ok) {
        console.error(`Error subiendo ${tipoDocumento} a MinIO:`, await resp.text())
        return
      }
      registrarAuditoria(profile.id, 'subir_factura', otNumber, file.name)
      onDocumentoSubido && onDocumentoSubido()
    } catch (e) {
      console.error(`Error subiendo ${tipoDocumento} a MinIO:`, e)
    }
  }

  // ── Compara los datos extraídos contra los de la OT y arma avisos ──────
  function compararConOT(datos) {
    const nuevosAvisos = []
    if (datos.ruc_cliente && rucOT && datos.ruc_cliente !== rucOT) {
      nuevosAvisos.push(`⚠ El RUC de la factura (${datos.ruc_cliente}) no coincide con el RUC de la OT (${rucOT}).`)
    }
    if (datos.cliente_nombre && clienteOT && !nombresParecidos(datos.cliente_nombre, clienteOT)) {
      nuevosAvisos.push(`⚠ El cliente de la factura ("${datos.cliente_nombre}") no se parece al cliente de la OT ("${clienteOT}").`)
    }
    if (nuevosAvisos.length > 0) {
      nuevosAvisos.push('Verifica que sea el documento correcto para esta OT.')
    }
    return nuevosAvisos
  }

  // ── Aplica los datos extraídos (de la IA o del XML) al formulario ─────
  // Función compartida entre ambos orígenes para que el mapeo de campos no
  // se desalinee entre uno y otro.
  function aplicarDatosExtraidos(datosOriginales) {
    const datos = sugerirDetraccion(datosOriginales)
    setDatosIA(datos)

    const avisos = compararConOT(datos)
    if (datos._detraccionSugerida) {
      avisos.push(
        `💡 Se sugirió detracción del ${DETRACCION_PORCENTAJE_DEFECTO}% (Cód. 037 — Otros Servicios Empresariales) ` +
        `por superar S/ ${DETRACCION_UMBRAL_MONTO}. Verifica si aplica antes de guardar.`
      )
    }
    setAvisos(avisos)

    if (!datos.numero_factura && !datos.fecha_emision && !datos.monto_total) {
      setMostrarDebug(true)
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
      moneda: datos.moneda || prev.moneda,
      referencia_oc: datos.referencia_oc || prev.referencia_oc,
      cliente_nombre: datos.cliente_nombre || prev.cliente_nombre,
      ruc_emisor: datos.ruc_emisor || prev.ruc_emisor,
      razon_social_emisor: datos.razon_social_emisor || prev.razon_social_emisor,
      ruc_cliente: datos.ruc_cliente || prev.ruc_cliente,
      direccion_cliente: datos.direccion_cliente || prev.direccion_cliente,
      guia_remision: datos.guia_remision || prev.guia_remision,
      valor_venta: datos.valor_venta ?? prev.valor_venta,
      igv: datos.igv ?? prev.igv,
      porcentaje_detraccion: datos.porcentaje_detraccion ?? prev.porcentaje_detraccion,
      codigo_bien_servicio_detraccion: datos.codigo_bien_servicio_detraccion || prev.codigo_bien_servicio_detraccion,
      glosa: datos.glosa || prev.glosa,
      observaciones: datos.observaciones || prev.observaciones,
    }))
    setEditando(true)
  }

  async function handleArchivoPDF(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Solo se aceptan archivos PDF.')
      return
    }
    setLeyendoPDF(true)
    setAvisos([])
    setDatosIA(null)

    // Subir el documento a "Documentos subidos" de Contabilidad, en paralelo
    // a la lectura con IA — no depende de que la IA tenga éxito.
    subirDocumentoFactura(file, 'Factura', 'Factura')

    try {
      const imagenBase64 = await renderizarPrimeraPaginaComoImagen(file)
      const datos = await leerFacturaConIA(imagenBase64)
      aplicarDatosExtraidos(datos)
    } catch (err) {
      console.error('Error leyendo factura con IA:', err)
      alert('No se pudo leer la factura: ' + err.message)
    }
    setLeyendoPDF(false)
  }

  // ── XML SUNAT (opcional) — datos exactos, sin usar IA ──────────────────
  async function handleArchivoXML(file) {
    if (!file || !/\.xml$/i.test(file.name)) {
      alert('Solo se aceptan archivos .xml')
      return
    }
    setLeyendoXML(true)
    setAvisos([])
    setDatosIA(null)

    subirDocumentoFactura(file, 'Factura XML', 'Factura_XML')

    try {
      const texto = await file.text()
      const datos = parsearXMLFactura(texto)
      aplicarDatosExtraidos(datos)
    } catch (err) {
      console.error('Error leyendo XML de factura:', err)
      alert('No se pudo leer el XML: ' + err.message)
    }
    setLeyendoXML(false)
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
      moneda: form.moneda || 'PEN',
      referencia_oc: form.referencia_oc.trim() || null,
      cliente_correo: form.cliente_correo.trim() || null,
      cliente_telefono: form.cliente_telefono.trim() || null,
      // ── Campos ampliados ──
      cliente_nombre: form.cliente_nombre.trim() || null,
      ruc_emisor: form.ruc_emisor.trim() || null,
      razon_social_emisor: form.razon_social_emisor.trim() || null,
      ruc_cliente: form.ruc_cliente.trim() || null,
      direccion_cliente: form.direccion_cliente.trim() || null,
      guia_remision: form.guia_remision.trim() || null,
      valor_venta: form.valor_venta === '' ? null : Number(form.valor_venta),
      igv: form.igv === '' ? null : Number(form.igv),
      porcentaje_detraccion: form.porcentaje_detraccion === '' ? null : Number(form.porcentaje_detraccion),
      codigo_bien_servicio_detraccion: form.codigo_bien_servicio_detraccion.trim() || null,
      glosa: form.glosa.trim() || null,
      observaciones: form.observaciones.trim() || null,
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
      setAvisos([])
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
        <div className="factura-metodos-grid">
          <div className="factura-metodo-panel metodo-ia">
            <div className="factura-metodo-header">
              <span className="factura-metodo-icon">🤖</span>
              <div>
                <div className="factura-metodo-titulo">Leer con IA</div>
                <span className="factura-metodo-badge">Desde el PDF</span>
              </div>
            </div>
            <FacturaDropzone
              onFile={handleArchivoPDF}
              leyendo={leyendoPDF}
              accept=".pdf"
              texto={leyendoPDF ? '🤖 Leyendo factura con IA...' : '📎 Arrastra el PDF aquí, o haz clic para seleccionar'}
            />
            <p className="factura-metodo-nota">
              Sube el PDF de la factura tal como lo descargas. La IA lee la imagen y completa el formulario. Este documento queda guardado como "Factura".
            </p>
          </div>

          <div className="factura-metodo-divider">O</div>

          <div className="factura-metodo-panel metodo-xml">
            <div className="factura-metodo-header">
              <span className="factura-metodo-icon">📋</span>
              <div>
                <div className="factura-metodo-titulo">XML SUNAT</div>
                <span className="factura-metodo-badge">Sin IA · Exacto</span>
              </div>
            </div>
            <FacturaDropzone
              onFile={handleArchivoXML}
              leyendo={leyendoXML}
              accept=".xml"
              texto={leyendoXML ? '📋 Leyendo XML...' : '📎 Arrastra el XML aquí, o haz clic para seleccionar'}
            />
            <p className="factura-metodo-nota">
              Si tu plataforma de facturación te da el XML, úsalo aquí: los datos salen directo de los campos oficiales, sin usar IA ni costo. Se guarda como "Factura XML".
            </p>
          </div>
        </div>
      )}

      {datosIA && (
        <div style={{ marginBottom: 14 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setMostrarDebug(true)}
          >
            🔍 Ver datos extraídos
          </button>
        </div>
      )}

      {avisos.length > 0 && (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--danger)', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {avisos.map((a, i) => <span key={i}>{a}</span>)}
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

          {(cobranza.ruc_emisor || cobranza.razon_social_emisor) && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              <b>Emisor:</b> {cobranza.razon_social_emisor || '—'} {cobranza.ruc_emisor && `· RUC: ${cobranza.ruc_emisor}`}
            </div>
          )}
          {(cobranza.cliente_nombre || cobranza.ruc_cliente) && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              <b>Cliente:</b> {cobranza.cliente_nombre || '—'} {cobranza.ruc_cliente && `· RUC: ${cobranza.ruc_cliente}`}
            </div>
          )}
          {cobranza.direccion_cliente && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}><b>Dirección:</b> {cobranza.direccion_cliente}</div>
          )}
          {cobranza.guia_remision && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}><b>Guía Remisión:</b> {cobranza.guia_remision}</div>
          )}

          {cobranza.valor_venta != null && (
            <div><b>Valor Venta:</b> {cobranza.moneda === 'USD' ? 'US$' : 'S/'} {Number(cobranza.valor_venta).toFixed(2)}</div>
          )}
          {cobranza.igv != null && (
            <div><b>IGV:</b> {cobranza.moneda === 'USD' ? 'US$' : 'S/'} {Number(cobranza.igv).toFixed(2)}</div>
          )}
          {cobranza.monto != null && (
            <div><b>Monto Total:</b> {cobranza.moneda === 'USD' ? 'US$' : 'S/'} {Number(cobranza.monto).toFixed(2)}</div>
          )}

          {cobranza.porcentaje_detraccion != null && (
            <div style={{ color: 'var(--text-muted)' }}>
              <b>Detracción:</b> {cobranza.porcentaje_detraccion}%
              {cobranza.monto_detraccion != null && ` — S/ ${Number(cobranza.monto_detraccion).toFixed(2)}`}
              {cobranza.numero_cuenta_detraccion && ` · Cta: ${cobranza.numero_cuenta_detraccion}`}
              {cobranza.codigo_bien_servicio_detraccion && ` · Cód.: ${cobranza.codigo_bien_servicio_detraccion}`}
            </div>
          )}
          {montoACobrar != null && (
            <div style={{ fontWeight: 700, color: 'var(--ocean-accent)' }}>
              Monto a cobrar: {cobranza.moneda === 'USD' ? 'US$' : 'S/'} {montoACobrar.toFixed(2)}
            </div>
          )}
          {cobranza.referencia_oc && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}><b>Ref. OC/OS:</b> {cobranza.referencia_oc}</div>
          )}
          {cobranza.glosa && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}><b>Glosa:</b> {cobranza.glosa}</div>
          )}
          {cobranza.observaciones && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>{cobranza.observaciones}</div>
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

          <div className="cobranza-subtitle">Emisor y Cliente</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>RUC Emisor</label>
              <input value={form.ruc_emisor} onChange={(e) => set('ruc_emisor', e.target.value)} placeholder="20605421696" />
            </div>
            <div>
              <label>Razón Social Emisor</label>
              <input value={form.razon_social_emisor} onChange={(e) => set('razon_social_emisor', e.target.value)} placeholder="Empresa emisora" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div>
              <label>Razón Social Cliente</label>
              <input value={form.cliente_nombre} onChange={(e) => set('cliente_nombre', e.target.value)} placeholder="Nombre del cliente que recibe la factura" />
            </div>
            <div>
              <label>RUC Cliente</label>
              <input value={form.ruc_cliente} onChange={(e) => set('ruc_cliente', e.target.value)} placeholder="20510248261" />
            </div>
          </div>
          <div>
            <label>Dirección Cliente</label>
            <input value={form.direccion_cliente} onChange={(e) => set('direccion_cliente', e.target.value)} placeholder="Dirección fiscal" />
          </div>

          <div className="cobranza-subtitle">Fechas y Condición</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Fecha de emisión</label>
              <input type="date" value={form.fecha_emision} onChange={(e) => set('fecha_emision', e.target.value)} />
            </div>
            <div>
              <label>Guía de Remisión (opcional)</label>
              <input value={form.guia_remision} onChange={(e) => set('guia_remision', e.target.value)} placeholder="TG01-237" />
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

          <div className="cobranza-subtitle">Montos</div>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 1fr', gap: 10, alignItems: 'end' }}>
            <div>
              <label>Moneda</label>
              <select value={form.moneda} onChange={(e) => set('moneda', e.target.value)}>
                <option value="PEN">S/</option>
                <option value="USD">US$</option>
              </select>
            </div>
            <div>
              <label>Valor Venta</label>
              <input type="number" step="0.01" value={form.valor_venta} onChange={(e) => set('valor_venta', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label>IGV</label>
              <input type="number" step="0.01" value={form.igv} onChange={(e) => set('igv', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label>Monto Total</label>
              <input type="number" step="0.01" value={form.monto} onChange={(e) => set('monto', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div>
            <label>Referencia OC/OS (opcional)</label>
            <input value={form.referencia_oc} onChange={(e) => set('referencia_oc', e.target.value)} placeholder="P001321 / 260710109" />
          </div>

          <div className="cobranza-subtitle">
            Detracción — auto-sugerida al {DETRACCION_PORCENTAJE_DEFECTO}% cuando el monto supera S/ {DETRACCION_UMBRAL_MONTO} (Cód. 037)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Porcentaje detracción (%)</label>
              <input type="number" step="0.01" value={form.porcentaje_detraccion} onChange={(e) => set('porcentaje_detraccion', e.target.value)} placeholder="Ej: 12" />
            </div>
            <div>
              <label>Monto detracción (S/)</label>
              <input type="number" step="0.01" value={form.monto_detraccion} onChange={(e) => set('monto_detraccion', e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label>Cuenta detracción (opcional)</label>
              <input value={form.numero_cuenta_detraccion} onChange={(e) => set('numero_cuenta_detraccion', e.target.value)} placeholder="00-014-XXXXXX" />
            </div>
            <div>
              <label>Código bien/servicio (opcional)</label>
              <input value={form.codigo_bien_servicio_detraccion} onChange={(e) => set('codigo_bien_servicio_detraccion', e.target.value)} placeholder="037" />
            </div>
          </div>
          {form.monto && form.monto_detraccion && (
            <p style={{ fontSize: 12, color: 'var(--ocean-accent)', margin: 0, fontWeight: 600 }}>
              Monto a cobrar: {form.moneda === 'USD' ? 'US$' : 'S/'} {(Number(form.monto) - Number(form.monto_detraccion)).toFixed(2)}
            </p>
          )}

          <div className="cobranza-subtitle">Contacto y Notas</div>
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
          <div>
            <label>Glosa (descripción del servicio/bien)</label>
            <input value={form.glosa} onChange={(e) => set('glosa', e.target.value)} placeholder="Ej: Servicio de calibración de..." />
          </div>
          <div>
            <label>Observaciones</label>
            <textarea rows={2} value={form.observaciones} onChange={(e) => set('observaciones', e.target.value)} placeholder="Notas adicionales relevantes para el pago..." style={{ resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : cobranza ? 'Guardar cambios' : 'Registrar factura'}
            </button>
            {cobranza && (
              <button className="btn btn-secondary" onClick={() => { setEditando(false); setAvisos([]) }}>Cancelar</button>
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
              clienteOT={service?.client}
              puedeEditar={puedeSubir}
              profile={profile}
              onDocumentoSubido={loadDocumentos}
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
            <DocumentosPorTipo documentos={documentos} abriendoId={abriendoId} onVer={verDocumento} />
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