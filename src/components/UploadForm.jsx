import { useState, useRef } from 'react'

const N8N_UPLOAD_URL = import.meta.env.VITE_N8N_UPLOAD_WEBHOOK_URL

// Calcula el hash SHA-256 del contenido del archivo (nativo del navegador, sin librerías).
// Dos archivos con contenido idéntico siempre producen el mismo hash, sin importar el nombre.
async function hashFile(file) {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function formatFecha(fechaIso) {
  if (!fechaIso) return ''
  return new Date(fechaIso).toLocaleString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function UploadForm({ otNumber, area, tipos, userId, documentosExistentes = [], onUploaded }) {
  const [tipo, setTipo] = useState(tipos[0]?.value || '')
  const [files, setFiles] = useState([]) // { key, file, hash, checking, duplicado }
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [message, setMessage] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [mostrarConfirmTipo, setMostrarConfirmTipo] = useState(false)
  const dragCounter = useRef(0)
  const fileInputRef = useRef(null)

  function addFiles(newFiles) {
    const existingKeys = new Set(files.map((f) => `${f.file.name}_${f.file.size}`))
    const toAdd = []
    for (const f of newFiles) {
      const key = `${f.name}_${f.size}`
      if (!existingKeys.has(key)) {
        toAdd.push({
          key: `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          file: f,
          hash: null,
          checking: true,
          duplicado: null,
        })
        existingKeys.add(key)
      }
    }
    if (toAdd.length === 0) return

    setFiles((prev) => [...prev, ...toAdd])

    // Calcula el hash de cada archivo en paralelo y lo compara contra los documentos
    // ya subidos a esta OT + área (Nivel 1: duplicado exacto de contenido)
    toAdd.forEach((item) => {
      hashFile(item.file)
        .then((hash) => {
          const match = documentosExistentes.find((d) => d.hash_archivo && d.hash_archivo === hash)
          setFiles((prev) =>
            prev.map((f) => (f.key === item.key ? { ...f, hash, checking: false, duplicado: match || null } : f))
          )
        })
        .catch(() => {
          setFiles((prev) => prev.map((f) => (f.key === item.key ? { ...f, checking: false } : f)))
        })
    })
  }

  function handleDragEnter(e) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
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

    const dropped = Array.from(e.dataTransfer.files || [])
    if (dropped.length > 0) {
      addFiles(dropped)
    }
  }

  function removeFile(key) {
    setFiles((prev) => prev.filter((f) => f.key !== key))
  }

  function handleTipoChange(e) {
    setTipo(e.target.value)
    setMostrarConfirmTipo(false)
  }

  async function uploadOne(item, tipoInfo) {
    const file = item.file
    const extension = file.name.split('.').pop()
    const nombreArchivo = `${tipo}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${extension}`

    const formData = new FormData()
    formData.append('file', file, nombreArchivo)
    formData.append('ot_number', otNumber)
    formData.append('area', area)
    formData.append('tipo_documento', tipo)
    formData.append('subcarpeta', tipoInfo.subcarpeta)
    formData.append('nombre_archivo', nombreArchivo)
    formData.append('subido_por', userId)
    formData.append('hash_archivo', item.hash || '')

    const res = await fetch(N8N_UPLOAD_URL, { method: 'POST', body: formData })
    if (!res.ok) throw new Error('Error al subir')
  }

  async function ejecutarSubida() {
    setMostrarConfirmTipo(false)
    setUploading(true)
    setMessage(null)

    const tipoInfo = tipos.find((t) => t.value === tipo)
    const aSubir = files.filter((f) => !f.duplicado)
    const duplicados = files.filter((f) => f.duplicado)

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < aSubir.length; i++) {
      setProgress({ current: i + 1, total: aSubir.length })
      try {
        await uploadOne(aSubir[i], tipoInfo)
        successCount++
      } catch (err) {
        failCount++
      }
    }

    const partes = []
    if (successCount > 0) partes.push(`${successCount} documento(s) subido(s) correctamente.`)
    if (failCount > 0) partes.push(`${failCount} fallaron. Intenta de nuevo con esos.`)
    if (duplicados.length > 0) {
      partes.push(`${duplicados.length} no se subieron por ser idénticos a documentos ya existentes en esta área.`)
    }
    if (partes.length === 0) partes.push('No se subió ningún documento.')

    setMessage({
      type: failCount > 0 || successCount === 0 ? 'error' : 'success',
      text: partes.join(' '),
    })

    setFiles([])
    setUploading(false)
    setProgress({ current: 0, total: 0 })
    onUploaded?.()
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!files.length) return

    const yaExisteTipo = documentosExistentes.some((d) => d.tipo_documento === tipo)
    if (yaExisteTipo) {
      setMostrarConfirmTipo(true)
      return
    }

    ejecutarSubida()
  }

  const hayVerificacionPendiente = files.some((f) => f.checking)
  const soloDuplicados = files.length > 0 && files.every((f) => f.duplicado)

  return (
    <form onSubmit={handleSubmit} className="card">
      <label>Tipo de documento</label>
      <select value={tipo} onChange={handleTipoChange}>
        {tipos.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <label>Archivo</label>

      <div
        className={`dropzone${isDragging ? ' dropzone-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => addFiles(Array.from(e.target.files))}
          style={{ display: 'none' }}
        />
        <p className="dropzone-text">
          {isDragging
            ? 'Suelta los archivos aquí'
            : 'Arrastra archivos aquí o haz clic para seleccionar'}
        </p>
      </div>

      {files.length > 0 && (
        <ul className="dropzone-file-list">
          {files.map((f) => (
            <li key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{f.file.name}</span>
                <button
                  type="button"
                  className="dropzone-remove-btn"
                  onClick={() => removeFile(f.key)}
                  aria-label={`Quitar ${f.file.name}`}
                >
                  ✕
                </button>
              </div>
              {f.checking && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Verificando duplicados...</span>
              )}
              {!f.checking && f.duplicado && (
                <span style={{ fontSize: 11, color: 'var(--danger, #f87171)' }}>
                  ⚠ Idéntico a uno ya subido por {f.duplicado._subido_por_nombre || '—'} el{' '}
                  {formatFecha(f.duplicado.created_at)}. No se subirá.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
          {files.length} archivo(s) seleccionado(s)
        </p>
      )}

      <button
        className="btn"
        type="submit"
        disabled={uploading || files.length === 0 || hayVerificacionPendiente || soloDuplicados}
      >
        {uploading
          ? `Subiendo ${progress.current}/${progress.total}...`
          : hayVerificacionPendiente
          ? 'Verificando archivos...'
          : soloDuplicados
          ? 'Todos son duplicados'
          : 'Subir documento(s)'}
      </button>

      {message && (
        <p className={message.type === 'success' ? 'success-msg' : 'error-msg'}>{message.text}</p>
      )}

      {mostrarConfirmTipo && (
        <div
          onClick={() => setMostrarConfirmTipo(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ maxWidth: 420, width: '100%' }}
          >
            <h4 style={{ marginTop: 0 }}>Ya existe un documento de este tipo</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              Ya se subió un documento tipo "{tipos.find((t) => t.value === tipo)?.label || tipo}" en esta
              área para {otNumber}. ¿Deseas subir este de todas formas como versión adicional?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMostrarConfirmTipo(false)}>
                Cancelar
              </button>
              <button type="button" className="btn" onClick={ejecutarSubida}>
                Subir de todas formas
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}