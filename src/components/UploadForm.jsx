import { useState } from 'react'

const N8N_UPLOAD_URL = import.meta.env.VITE_N8N_UPLOAD_WEBHOOK_URL

export default function UploadForm({ otNumber, area, tipos, userId, onUploaded }) {
  const [tipo, setTipo] = useState(tipos[0]?.value || '')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setMessage(null)

    const tipoInfo = tipos.find((t) => t.value === tipo)
    const extension = file.name.split('.').pop()
    const nombreArchivo = `${tipo}_${Date.now()}.${extension}`

    const formData = new FormData()
    formData.append('file', file, nombreArchivo)
    formData.append('ot_number', otNumber)
    formData.append('area', area)
    formData.append('tipo_documento', tipo)
    formData.append('subcarpeta', tipoInfo.subcarpeta)
    formData.append('nombre_archivo', nombreArchivo)
    formData.append('subido_por', userId)

    try {
      const res = await fetch(N8N_UPLOAD_URL, { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Error al subir')
      setMessage({ type: 'success', text: 'Documento subido correctamente.' })
      setFile(null)
      onUploaded?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'No se pudo subir el documento. Intenta de nuevo.' })
    } finally {
      setUploading(false)
    }
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
      <input type="file" onChange={(e) => setFile(e.target.files[0])} required />

      <button className="btn" type="submit" disabled={uploading}>
        {uploading ? 'Subiendo...' : 'Subir documento'}
      </button>

      {message && (
        <p className={message.type === 'success' ? 'success-msg' : 'error-msg'}>{message.text}</p>
      )}
    </form>
  )
}
