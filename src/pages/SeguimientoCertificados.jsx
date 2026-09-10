// src/components/certificados/CertificadosModule.jsx
import React, { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useCertificados, MAGNITUDES, ESTADOS } from '../../hooks/useCertificados'


const MAGNITUDES_LABEL = {
  masa_balanza:  'Masa Balanza',
  masa_pesas:    'Masa Pesas',
  presion:       'Presión',
  temperatura:   'Temperatura',
  fuerza:        'Fuerza',
  longitud:      'Longitud',
  energia:       'Energía',
  eq_medicos:    'Eq. Médicos',
  quimica:       'Química',
  otras:         'Otras Magnitudes',
  mantenimiento: 'Ensayo/Mant./Verif.',
}

const isMobile = () => window.innerWidth < 768

// ── Modal de edición ──────────────────────────────────────────
// ── FIX: una vez asignado el código, los campos que definen a qué
// equipo/OT corresponde (equipo, marca, modelo, N° serie, cliente, OT) ya
// no se pueden tocar — solo quedan editables la fecha de calibración y las
// observaciones. Esto evita que un certificado termine "migrando" a un
// equipo distinto del que originó su código.
function EditModal({ cert, onClose, onSave }) {
  const mag = MAGNITUDES.find(m => m.id === cert.magnitud)
  const [form, setForm] = useState({
    observaciones:     cert.observaciones || '',
    fecha_calibracion: cert.fecha_calibracion || new Date().toISOString().split('T')[0],
  })
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    await onSave(cert.id, form)
    setSaving(false)
    onClose()
  }

  const campoBloqueado = (valor) => (
    <div style={{
      width: '100%', fontSize: '12px', padding: '7px 10px',
      border: '1px solid var(--border)', borderRadius: '7px',
      background: 'var(--bg)', color: 'var(--text2)',
      boxSizing: 'border-box', opacity: 0.75,
    }}>{valor || '—'}</div>
  )

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: '14px', width: '100%', maxWidth: '500px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>Editar certificado</div>
            <div style={{ fontSize: '11px', fontFamily: 'monospace', color: mag?.color, marginTop: '2px' }}>
              {cert.codigo}{cert.ot_number ? ` · ${cert.ot_number}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: '6px', color: 'var(--text2)', cursor: 'pointer',
            width: '28px', height: '28px', fontSize: '14px',
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{
            fontSize: '10px', color: 'var(--text2)', background: 'rgba(245,158,11,.08)',
            border: '1px solid rgba(245,158,11,.25)', borderRadius: '7px', padding: '8px 10px',
          }}>
            🔒 El equipo, la OT y los datos del cliente quedan fijos una vez asignado el código — solo se puede
            ajustar la fecha de calibración y las observaciones.
          </div>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>Equipo</div>
            {campoBloqueado(cert.equipo)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>Marca</div>
              {campoBloqueado(cert.marca)}
            </div>
            <div>
              <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>Modelo</div>
              {campoBloqueado(cert.modelo)}
            </div>
            <div>
              <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>N° Serie</div>
              {campoBloqueado(cert.numero_serie)}
            </div>
            <div>
              <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>Cliente</div>
              {campoBloqueado(cert.cliente)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>Fecha calibración</div>
            <input type="date" value={form.fecha_calibracion} onChange={set('fecha_calibracion')} style={{
              width: '100%', fontSize: '12px', padding: '7px 10px',
              border: '1px solid var(--border)', borderRadius: '7px',
              background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
            }}/>
          </div>
          <div>
            <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text2)', marginBottom: '5px' }}>Observaciones</div>
            <textarea value={form.observaciones} onChange={set('observaciones')} rows={2} placeholder="Observaciones..." style={{
              width: '100%', fontSize: '12px', padding: '7px 10px',
              border: '1px solid var(--border)', borderRadius: '7px',
              background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
              resize: 'vertical',
            }}/>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: '8px', justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: '7px',
            border: '1px solid var(--border)', background: 'var(--bg3)',
            color: 'var(--text2)', fontSize: '12px', cursor: 'pointer',
          }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '8px 20px', borderRadius: '7px', border: 'none',
            background: saving ? 'var(--bg3)' : mag?.color || '#1D9E75',
            color: saving ? 'var(--text2)' : '#fff',
            fontSize: '12px', fontWeight: '700', cursor: 'pointer',
          }}>{saving ? 'Guardando...' : '✓ Guardar'}</button>
        </div>
      </div>
    </div>
  )
}


// ── Modal selector de laboratorio ──────────────────────────────
// SIEMPRE muestra el <select> de magnitud/laboratorio, editable.
// Si hubo detección automática, se precarga como sugerencia (con
// aviso visual), pero el usuario puede corregirla libremente antes
// de confirmar. Ya no hay una rama "detectado -> solo mostrar texto".
function ModalSelectLab({ datos, onConfirm, onClose }) {
  const [magnitud, setMagnitud] = React.useState(datos.magnitud || '')
  const fueDetectado = !!datos.magnitud

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,.75)',
      zIndex:99999,display:'flex',alignItems:'center',justifyContent:'center',padding:16,
    }}>
      <div style={{
        background:'var(--bg2)',border:'1px solid var(--border)',
        borderRadius:14,width:420,maxWidth:'95vw',padding:24,
        animation:'fadeUp .2s ease',
      }}>
        <div style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:4}}>
          📋 Enviar a Certificados
        </div>
        <div style={{fontSize:11,color:'var(--text2)',marginBottom:16,fontFamily:'var(--mono)'}}>
          {datos.equipo}
        </div>

        {fueDetectado && (
          <div style={{
            background:'rgba(0,229,184,.08)',border:'1px solid rgba(0,229,184,.3)',
            borderRadius:8,padding:'10px 12px',marginBottom:12,
            fontSize:11,color:'#00e5b8',fontFamily:'var(--mono)',
          }}>
            💡 Sugerencia automática: <b>{MAGNITUDES_LABEL[datos.magnitud] || datos.magnitud}</b>
            <div style={{fontSize:10,color:'var(--text2)',marginTop:4}}>
              Verifica y corrige si no corresponde 👇
            </div>
          </div>
        )}

        <div style={{marginBottom:16}}>
          <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',
            color:'var(--text2)',fontFamily:'var(--mono)',marginBottom:6}}>
            Laboratorio / Magnitud *
          </div>
          <select
            value={magnitud}
            onChange={e=>setMagnitud(e.target.value)}
            style={{width:'100%',fontSize:13,padding:'9px 12px',
              border:`1px solid ${magnitud?'var(--accent)':'var(--border)'}`,
              borderRadius:8,background:'var(--bg3)',color:'var(--text)',outline:'none'}}
          >
            <option value="">— Seleccionar —</option>
            {Object.entries(MAGNITUDES_LABEL).map(([id,lbl])=>(
              <option key={id} value={id}>{lbl}</option>
            ))}
          </select>
        </div>

        {/* Preview de datos */}
        <div style={{background:'var(--bg3)',borderRadius:8,padding:'10px 12px',marginBottom:16,
          display:'flex',flexDirection:'column',gap:4}}>
          {[['Equipo',datos.equipo],['Marca',datos.marca],['Modelo',datos.modelo],
            ['N° Serie',datos.numero_serie],['Cliente',datos.cliente]].map(([k,v])=>v?(
            <div key={k} style={{display:'flex',gap:8,fontSize:11}}>
              <span style={{color:'var(--text2)',fontFamily:'var(--mono)',fontSize:9,
                textTransform:'uppercase',width:60,flexShrink:0,paddingTop:1}}>{k}</span>
              <span style={{color:'var(--text)',fontWeight:600}}>{v}</span>
            </div>
          ):null)}
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{
            padding:'7px 16px',borderRadius:7,border:'1px solid var(--border)',
            background:'var(--bg3)',color:'var(--text2)',fontSize:12,cursor:'pointer',
          }}>Cancelar</button>
          <button
            disabled={!magnitud}
            onClick={()=>onConfirm({...datos, magnitud})}
            style={{
              padding:'7px 18px',borderRadius:7,border:'none',
              background:!magnitud?'var(--bg3)':'#00e5b8',
              color:!magnitud?'var(--text2)':'#000',
              fontSize:12,fontWeight:700,cursor:'pointer',
            }}>
            ✓ Confirmar y abrir
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tarjeta de certificado ────────────────────────────────────
function CertCard({ cert, onEstadoChange, onEdit, onAnular, currentUserId, esAdmin, onAbrirOT, onVerDocumentoOT }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const estado = ESTADOS[cert.estado] || ESTADOS.en_progreso
  const mag = MAGNITUDES.find(m => m.id === cert.magnitud)
  const esMio = cert.tecnico_id === currentUserId

  const handleEstado = async (e) => {
    e.stopPropagation()
    if (cert.estado === 'emitido' || cert.estado === 'anulado') return
    setSaving(true)
    const orden = ['en_progreso', 'revision', 'emitido']
    const idx = orden.indexOf(cert.estado)
    const next = orden[idx + 1]
    if (next) await onEstadoChange(cert.id, next)
    setSaving(false)
  }

  const fecha = cert.created_at
    ? new Date(cert.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  return (
    <div style={{
      background: 'var(--bg3)',
      border: '0.5px solid var(--border)',
      borderLeft: `3px solid ${mag?.color || '#00e5b8'}`,
      borderRadius: '10px',
      padding: '12px 14px',
      marginBottom: '8px',
    }}>
      {/* Fila superior */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        <span style={{
          fontFamily: 'monospace', fontSize: '12px', fontWeight: '700',
          color: mag?.color || '#00e5b8', letterSpacing: '0.5px', flex: 1,
          cursor: 'pointer',
        }} onClick={() => setExpanded(!expanded)}>{cert.codigo}</span>

        {/* OT de origen — enlace para abrir esa OT directo desde aquí, y un
             ojo aparte para ver SOLO el documento Word sin abrir todo el
             modal de la OT (5 pestañas, edición, etc). */}
        {cert.ot_number && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              onClick={e => { e.stopPropagation(); onAbrirOT?.(cert.ot_number) }}
              title={`Abrir ${cert.ot_number}`}
              style={{
                fontFamily: 'monospace', fontSize: '10px', fontWeight: 700,
                color: '#0ea5e9', background: 'rgba(14,165,233,.1)',
                border: '0.5px solid rgba(14,165,233,.3)', borderRadius: '5px',
                padding: '2px 8px', cursor: 'pointer',
                textDecoration: 'underline', textUnderlineOffset: '2px',
              }}
            >
              📄 {cert.ot_number}
            </span>
            <button
              onClick={e => { e.stopPropagation(); onVerDocumentoOT?.(cert.ot_number) }}
              title={`Ver solo el documento de ${cert.ot_number}`}
              style={{
                background: 'rgba(14,165,233,.1)', border: '0.5px solid rgba(14,165,233,.3)',
                borderRadius: '5px', color: '#0ea5e9', cursor: 'pointer',
                fontSize: '11px', padding: '2px 6px', lineHeight: 1,
              }}
            >👁</button>
          </span>
        )}

        <span onClick={handleEstado} style={{
          fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
          background: estado.bg, color: estado.color,
          cursor: cert.estado !== 'emitido' && cert.estado !== 'anulado' ? 'pointer' : 'default',
          opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap', flexShrink: 0,
        }}>{saving ? '...' : estado.label}</span>

        {/* Botón editar — solo si es el técnico que lo creó */}
        {esMio && (
          <button onClick={e => { e.stopPropagation(); onEdit(cert) }} style={{
            background: 'transparent', border: '0.5px solid var(--border)',
            borderRadius: '5px', color: 'var(--text2)', cursor: 'pointer',
            fontSize: '11px', padding: '2px 7px', flexShrink: 0,
          }}>✏️</button>
        )}
        {/* Botón anular — solo admin o técnico dueño, solo si no está ya anulado */}
        {(esAdmin || esMio) && cert.estado !== 'anulado' && (
          <button onClick={e => {
            e.stopPropagation()
            const motivo = window.prompt(
              `Anular ${cert.codigo}\n\nEl certificado quedará como ANULADO en el registro.\nEsto es requerido por ISO 17025.\n\nMotivo de anulación (opcional):`
            )
            if (motivo !== null) onAnular(cert.id, motivo || 'Sin motivo especificado')
          }} style={{
            background: 'transparent', border: '0.5px solid rgba(239,68,68,.3)',
            borderRadius: '5px', color: '#ef4444', cursor: 'pointer',
            fontSize: '10px', padding: '2px 7px', flexShrink: 0,
            fontFamily: 'var(--mono)', fontWeight: 700,
          }}>✕ Anular</button>
        )}
      </div>

      <div onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        {cert.estado === 'anulado' && (
          <div style={{
            fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700,
            color: '#ef4444', background: 'rgba(239,68,68,.08)',
            border: '1px solid rgba(239,68,68,.2)', borderRadius: 4,
            padding: '2px 8px', marginBottom: 5, display: 'inline-block',
          }}>
            ✕ ANULADO {cert.motivo_anulacion ? `— ${cert.motivo_anulacion}` : ''}
          </div>
        )}
        {cert.estado === 'emitido' && (
          // ── Mismo anuncio destacado que en Ingresos (MetroTrack App.jsx) —
          // ícono SVG en vez de emoji, se ve igual en cualquier sistema.
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '8px 12px', borderRadius: 8, marginBottom: 6,
            background: 'linear-gradient(135deg,#0ea472,#059669)',
            boxShadow: '0 3px 12px rgba(16,185,129,.3)',
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', letterSpacing: '.2px' }}>
              Certificado emitido{cert.fecha_emision ? ` — ${new Date(cert.fecha_emision).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
            </span>
          </div>
        )}
        <div style={{ fontSize: '13px', fontWeight: '600', color: cert.estado === 'anulado' ? 'var(--text2)' : 'var(--text)', marginBottom: '3px', lineHeight: 1.3, textDecoration: cert.estado === 'anulado' ? 'line-through' : 'none', opacity: cert.estado === 'anulado' ? 0.6 : 1 }}>
          {cert.equipo}
          {cert.marca && <span style={{ color: 'var(--text2)', fontWeight: '400' }}> — {cert.marca}</span>}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text2)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {cert.cliente && <span>📍 {cert.cliente}</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{fecha}</span>
        </div>
      </div>

      {expanded && (
        <div style={{
          marginTop: '10px', paddingTop: '10px',
          borderTop: '0.5px solid var(--border)',
          fontSize: '11px', color: 'var(--text2)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px',
        }}>
          {cert.modelo && <span><b>Modelo:</b> {cert.modelo}</span>}
          {cert.numero_serie && <span><b>N/S:</b> {cert.numero_serie}</span>}
          {cert.tecnico_nombre && <span><b>Técnico:</b> {cert.tecnico_nombre}</span>}
          {cert.fecha_calibracion && <span><b>Calibración:</b> {cert.fecha_calibracion}</span>}
          {cert.observaciones && <span style={{ gridColumn: '1/-1' }}><b>Obs:</b> {cert.observaciones}</span>}
        </div>
      )}
    </div>
  )
}

// ── Formulario nuevo certificado ─────────────────────────────
// ── FIX: ya no se puede crear un certificado escribiendo el equipo desde
// cero en esta pantalla. Antes, cualquiera podía escribir un nombre de
// equipo aquí mismo y darle "+ Agregar" sin que existiera ningún Ingreso
// real detrás — eso generaba certificados "huérfanos", sin relación con
// ningún equipo de una OT concreta, y rompía la coherencia de las rutas de
// documentos (el certificado no correspondía a nada real en MinIO/Ingresos).
// Ahora el formulario de creación SOLO aparece habilitado cuando los datos
// llegan prellenados desde la pestaña "Ingresos" (botón "📋 → Certificados"
// en MetroTrack). Sin ese prefill, se muestra un mensaje señalando el
// camino correcto en vez del campo de texto libre.
function NuevoForm({ magnitudActiva, proximoCodigo, onCrear, prefill, onPrefillApplied, onCertificadoAsignado }) {
  const init = {
    equipo: '', marca: '', modelo: '', numero_serie: '',
    cliente: '', observaciones: '', ot_number: '', ingreso_id: null,
    fecha_calibracion: new Date().toISOString().split('T')[0],
  }
  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [showExtra, setShowExtra] = useState(false)
  const [habilitado, setHabilitado] = useState(false) // solo true tras llegar desde Ingresos
  const mag = MAGNITUDES.find(m => m.id === magnitudActiva)
  const codigo = proximoCodigo(magnitudActiva)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  // Aplicar prefill cuando llega desde Ingresos — esta es la ÚNICA forma de
  // habilitar el formulario de creación.
  React.useEffect(() => {
    if (!prefill) return
    setForm(f => ({
      ...f,
      equipo:       prefill.equipo       || f.equipo,
      marca:        prefill.marca        || f.marca,
      modelo:       prefill.modelo       || f.modelo,
      numero_serie: prefill.numero_serie || f.numero_serie,
      cliente:      prefill.cliente      || f.cliente,
      ot_number:    prefill.ot_number    || f.ot_number,
      ingreso_id:   prefill.ingreso_id   ?? f.ingreso_id,
    }))
    setShowExtra(true)  // mostrar campos extra automáticamente
    setHabilitado(true)
    onPrefillApplied?.()
  }, [prefill])

  const handleSubmit = async () => {
    if (!form.equipo.trim()) return
    setSaving(true)
    const result = await onCrear({ ...form, magnitud: magnitudActiva })
    // ── Escribir el código de vuelta en el Ingreso que lo originó ──────────
    // Sin esto, el código quedaba creado en la tabla certificados pero el
    // campo "Código de Certificado" de ese equipo en Ingresos se quedaba
    // vacío para siempre, en cualquier magnitud.
    // El RPC crear_certificado puede devolver la fila como objeto directo
    // {codigo:...} o envuelta en un array [{codigo:...}] según cómo la
    // interprete PostgREST — se cubren ambos casos para no perder el dato
    // en silencio si viene en la forma que no esperábamos.
    if (result.ok && form.ot_number && form.ingreso_id) {
      const filaCreada = Array.isArray(result.data) ? result.data[0] : result.data
      const codigoCreado = filaCreada?.codigo
      if (codigoCreado) {
        await onCertificadoAsignado?.({
          ot_number: form.ot_number,
          ingreso_id: form.ingreso_id,
          codigo: codigoCreado,
        })
      } else {
        console.error('crear_certificado no devolvió un código utilizable:', result.data)
      }
    }
    if (result.ok) { setForm(init); setShowExtra(false); setHabilitado(false) }
    setSaving(false)
  }

  if (!habilitado) {
    return (
      <div style={{
        borderBottom: '0.5px solid var(--border)',
        background: 'var(--bg2)', padding: '14px 16px', flexShrink: 0,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '11px', color: 'var(--text2)', lineHeight: 1.5 }}>
          Para asignar un código de certificado, ve a la pestaña <b style={{ color: 'var(--text)' }}>📦 Ingresos</b> de
          la OT correspondiente y usa el botón <b style={{ color: 'var(--text)' }}>"📋 → Certificados"</b> junto al equipo.
        </div>
        <div style={{ fontSize: '9px', fontFamily: 'monospace', color: mag?.color, marginTop: '8px', letterSpacing: '0.5px' }}>
          Próximo código de {mag?.label.toLowerCase()}: <b>{codigo}</b>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      borderBottom: '0.5px solid var(--border)',
      background: 'var(--bg2)', padding: '10px 12px', flexShrink: 0,
    }}>
      <div style={{ fontSize: '10px', fontFamily: 'monospace', color: mag?.color, marginBottom: '8px', letterSpacing: '0.5px' }}>
        Próximo código: <b>{codigo}</b>
        {form.ot_number && <span style={{ color: '#0ea5e9', marginLeft: 10 }}>· 📄 {form.ot_number}</span>}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: showExtra ? '8px' : '0' }}>
        <input
          value={form.equipo} onChange={set('equipo')}
          onKeyDown={e => e.key === 'Enter' && !showExtra && handleSubmit()}
          placeholder="Nombre del equipo..." disabled={saving}
          style={{
            flex: 1, fontSize: '13px', padding: '9px 12px',
            border: `1px solid ${mag?.color}40`, borderRadius: '8px',
            background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
          }}
        />
        <button onClick={() => setShowExtra(!showExtra)} style={{
          padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--border)',
          background: showExtra ? `${mag?.color}20` : 'var(--bg3)',
          color: showExtra ? mag?.color : 'var(--text2)',
          fontSize: '14px', cursor: 'pointer', flexShrink: 0,
        }}>⋯</button>
        <button onClick={handleSubmit} disabled={saving || !form.equipo.trim()} style={{
          padding: '9px 16px', borderRadius: '8px', border: 'none',
          background: saving || !form.equipo.trim() ? 'var(--bg3)' : mag?.color || '#1D9E75',
          color: saving || !form.equipo.trim() ? 'var(--text3)' : '#fff',
          fontSize: '13px', fontWeight: '700', cursor: 'pointer', flexShrink: 0,
        }}>{saving ? '...' : '+ Agregar'}</button>
      </div>
      {showExtra && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          {[['marca','Marca'],['modelo','Modelo'],['numero_serie','N° Serie'],['cliente','Cliente']].map(([k, lbl]) => (
            <input key={k} value={form[k]} onChange={set(k)} placeholder={lbl} style={{
              fontSize: '12px', padding: '7px 10px',
              border: '0.5px solid var(--border)', borderRadius: '7px',
              background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
            }}/>
          ))}
          <input type="date" value={form.fecha_calibracion} onChange={set('fecha_calibracion')} style={{
            fontSize: '12px', padding: '7px 10px',
            border: '0.5px solid var(--border)', borderRadius: '7px',
            background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
          }}/>
          <input value={form.observaciones} onChange={set('observaciones')} placeholder="Observaciones" style={{
            fontSize: '12px', padding: '7px 10px',
            border: '0.5px solid var(--border)', borderRadius: '7px',
            background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
          }}/>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────
export default function CertificadosModule({ prefill, onPrefillUsed, onAbrirOT, onVerDocumentoOT, onCertificadoAsignado }) {
  const [magnitudActiva, setMagnitudActiva] = useState('masa_balanza')
  const [busqueda, setBusqueda] = useState('')
  const [mobile, setMobile] = useState(isMobile())
  const [editando, setEditando] = useState(null)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [modalLab, setModalLab] = useState(null)   // datos prefill pendiente de confirmar
  const [formPrefill, setFormPrefill] = useState(null) // datos listos para inyectar en NuevoForm
  const feedRef = useRef()

  useEffect(() => {
    const handler = () => setMobile(isMobile())
    window.addEventListener('resize', handler)
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data?.user?.id || null
      setCurrentUserId(uid)
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles').select('role').eq('id', uid).single()
        setEsAdmin(prof?.role === 'admin')
      }
    })
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Recibir prefill desde Ingresos
  useEffect(() => {
    if (!prefill) return
    // Siempre mostramos el modal de selección/confirmación de laboratorio,
    // tanto si hubo detección automática como si no. El usuario decide.
    setModalLab(prefill)
    onPrefillUsed?.()
  }, [prefill])

  const handleConfirmLab = (datos) => {
    setMagnitudActiva(datos.magnitud)
    setFormPrefill(datos)
    setModalLab(null)
  }

  const {
    certificados, loading, error, onlineUsers,
    crearCertificado, actualizarEstado, editarCertificado, proximoCodigo,
    refetch,
  } = useCertificados(magnitudActiva)

  const anularCertificado = async (id, motivo) => {
    await supabase.from('certificados')
      .update({ estado: 'anulado', motivo_anulacion: motivo })
      .eq('id', id)
    refetch()
  }

  const [esAdmin, setEsAdmin] = useState(false)

  const magActiva = MAGNITUDES.find(m => m.id === magnitudActiva)

  const filtrados = certificados.filter(c => {
    if (!busqueda) return true
    const q = busqueda.toLowerCase()
    return c.codigo?.toLowerCase().includes(q) ||
      c.equipo?.toLowerCase().includes(q) ||
      c.cliente?.toLowerCase().includes(q)
  })

  const cambiarMagnitud = (id) => {
    setMagnitudActiva(id)
    setBusqueda('')
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: mobile ? 'column' : 'row',
      height: mobile ? 'calc(100vh - 220px)' : 'calc(100vh - 148px)',
      background: 'var(--bg)', overflow: 'hidden',
    }}>

      {/* SIDEBAR */}
      <div style={{
        width: mobile ? '100%' : '210px', flexShrink: 0,
        background: 'var(--bg2)',
        borderRight: mobile ? 'none' : '0.5px solid var(--border)',
        borderBottom: mobile ? '0.5px solid var(--border)' : 'none',
        padding: mobile ? '8px 12px' : '14px 8px',
      }}>
        {!mobile && (
          <div style={{ padding: '4px 8px 12px', borderBottom: '0.5px solid var(--border)', marginBottom: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)' }}>Certificados</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>Metromecanica Lab</div>
          </div>
        )}
        {mobile ? (
          <select value={magnitudActiva} onChange={e => cambiarMagnitud(e.target.value)} style={{
            width: '100%', fontSize: '13px', fontWeight: '600', padding: '8px 12px',
            borderRadius: '8px', border: `1px solid ${magActiva?.color || 'var(--border)'}`,
            background: 'var(--bg3)', color: magActiva?.color || 'var(--text)',
            outline: 'none', cursor: 'pointer',
          }}>
            {MAGNITUDES.map(mag => (
              <option key={mag.id} value={mag.id}>{mag.label}</option>
            ))}
          </select>
        ) : (
          MAGNITUDES.map(mag => (
            <button key={mag.id} onClick={() => cambiarMagnitud(mag.id)} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '7px 10px', margin: '1px 0', borderRadius: '7px',
              border: 'none', width: '100%', textAlign: 'left',
              background: magnitudActiva === mag.id ? 'var(--bg3)' : 'transparent',
              color: magnitudActiva === mag.id ? 'var(--text)' : 'var(--text2)',
              fontSize: '12px', fontWeight: magnitudActiva === mag.id ? '600' : '400',
              cursor: 'pointer',
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: mag.color, flexShrink: 0 }}/>
              {mag.label}
            </button>
          ))
        )}
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{
          padding: mobile ? '8px 12px' : '10px 16px',
          borderBottom: '0.5px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'var(--bg2)', flexShrink: 0,
        }}>
          <span style={{ fontSize: mobile ? '13px' : '14px', fontWeight: '600', color: magActiva?.color }}>
            # {magActiva?.label.toLowerCase()}
          </span>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar..." style={{
            flex: 1, maxWidth: mobile ? '100%' : '280px',
            fontSize: '12px', padding: '5px 10px',
            border: '0.5px solid var(--border)', borderRadius: '16px',
            background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
          }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#1D9E75' }}/>
            <span style={{ fontSize: '10px', color: '#0F6E56' }}>{onlineUsers}</span>
          </div>
        </div>

        {/* Formulario — arriba, junto al encabezado, para no tener que
             bajar hasta el final de la lista cada vez que se agrega un
             código nuevo. */}
        <NuevoForm magnitudActiva={magnitudActiva} proximoCodigo={proximoCodigo} onCrear={crearCertificado} prefill={formPrefill} onPrefillApplied={()=>setFormPrefill(null)} onCertificadoAsignado={onCertificadoAsignado} />

        {/* Feed */}
        <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', padding: mobile ? '10px 12px' : '12px 16px' }}>
          {loading && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '13px' }}>Cargando...</div>}
          {error && <div style={{ padding: '12px', background: '#FCEBEB', borderRadius: '8px', color: '#A32D2D', fontSize: '12px' }}>Error: {error}</div>}
          {!loading && filtrados.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text3)' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
              <div style={{ fontSize: '13px' }}>{busqueda ? 'Sin resultados' : `No hay certificados de ${magActiva?.label.toLowerCase()} aún`}</div>
              <div style={{ fontSize: '11px', marginTop: '6px' }}>Próximo: <b style={{ color: magActiva?.color }}>{proximoCodigo(magnitudActiva)}</b></div>
            </div>
          )}
          {filtrados.map(cert => (
            <CertCard
              key={cert.id}
              cert={cert}
              onEstadoChange={actualizarEstado}
              onEdit={setEditando}
              onAnular={anularCertificado}
              currentUserId={currentUserId}
              esAdmin={esAdmin}
              onAbrirOT={onAbrirOT}
              onVerDocumentoOT={onVerDocumentoOT}
            />
          ))}
        </div>
      </div>

      {/* Modal selector laboratorio (desde Ingresos) */}
      {modalLab && (
        <ModalSelectLab
          datos={modalLab}
          onConfirm={handleConfirmLab}
          onClose={() => setModalLab(null)}
        />
      )}

      {/* Modal edición */}
      {editando && (
        <EditModal
          cert={editando}
          onClose={() => setEditando(null)}
          onSave={editarCertificado}
        />
      )}

      <style>{`
        :root { --text3: #4a5568; }
        input:focus, textarea:focus { border-color: var(--accent) !important; }
      `}</style>
    </div>
  )
}