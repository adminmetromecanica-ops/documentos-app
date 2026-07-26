import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Correo o contraseña incorrectos.')
    setLoading(false)
  }

  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 80 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Metromecanica — Documentos</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Ingresa con tu cuenta para ver y subir los documentos de tu área.
        </p>
        <form onSubmit={handleLogin}>
          <label>Correo</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
          {error && <p className="error-msg">{error}</p>}
        </form>
      </div>
    </div>
  )
}
