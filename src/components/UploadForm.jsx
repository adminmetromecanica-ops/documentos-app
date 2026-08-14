import { useState } from 'react'

const N8N_UPLOAD_URL = import.meta.env.VITE_N8N_UPLOAD_WEBHOOK_URL

export default function UploadForm({ otNumber, area, tipos, userId, onUploaded }) {
  const [tipo, setTipo] = useState(tipos[0]?.value || '')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [message, setMessage] = useState(null)

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
      <input
        type="file"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files))}
        required
      />
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