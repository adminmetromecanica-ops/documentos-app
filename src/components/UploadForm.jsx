import { useState, useRef } from 'react'

const N8N_UPLOAD_URL = import.meta.env.VITE_N8N_UPLOAD_WEBHOOK_URL

export default function UploadForm({ otNumber, area, tipos, userId, onUploaded }) {
  const [tipo, setTipo] = useState(tipos[0]?.value || '')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [message, setMessage] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const fileInputRef = useRef(null)

  function addFiles(newFiles) {
    // Evita duplicados exactos (mismo nombre + tamaño) si el usuario arrastra dos veces
    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}`))
      const merged = [...prev]
      for (const f of newFiles) {
        const key = `${f.name}_${f.size}`
        if (!existingKeys.has(key)) {
          merged.push(f)
          existingKeys.add(key)
        }
      }
      return merged
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

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function uploadOne(file, tipoInfo) {
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

    const res = await fetch(N8N_UPLOAD_URL, { method: 'POST', body: formData })
    if (!res.ok) throw new Error('Error al subir')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!files.length) return
    setUploading(true)
    setMessage(null)

    const tipoInfo = tipos.find((t) => t.value === tipo)
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length })
      try {
        await uploadOne(files[i], tipoInfo)
        successCount++
      } catch (err) {
        failCount++
      }
    }

    if (failCount === 0) {
      setMessage({ type: 'success', text: `${successCount} documento(s) subido(s) correctamente.` })
    } else if (successCount === 0) {
      setMessage({ type: 'error', text: 'No se pudo subir ningún documento. Intenta de nuevo.' })
    } else {
      setMessage({
        type: 'error',
        text: `${successCount} subido(s), ${failCount} fallaron. Intenta de nuevo con los que fallaron.`,
      })
    }

    setFiles([])
    setUploading(false)
    setProgress({ current: 0, total: 0 })
    onUploaded?.()
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <label>Tipo de documento</label>
      <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
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
          {files.map((f, i) => (
            <li key={`${f.name}_${f.size}_${i}`}>
              <span>{f.name}</span>
              <button
                type="button"
                className="dropzone-remove-btn"
                onClick={() => removeFile(i)}
                aria-label={`Quitar ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
          {files.length} archivo(s) seleccionado(s)
        </p>
      )}

      <button className="btn" type="submit" disabled={uploading || files.length === 0}>
        {uploading
          ? `Subiendo ${progress.current}/${progress.total}...`
          : 'Subir documento(s)'}
      </button>

      {message && (
        <p className={message.type === 'success' ? 'success-msg' : 'error-msg'}>{message.text}</p>
      )}
    </form>
  )
}