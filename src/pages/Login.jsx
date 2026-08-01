import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revisandoSesion, setRevisandoSesion] = useState(true)

  // Paso 2: verificación TOTP (solo aparece si la cuenta tiene 2FA activado)
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [factorId, setFactorId] = useState(null)

  // Si ya existe una sesión (nivel 1) que necesita el segundo factor —por
  // ejemplo, App.jsx nos devolvió aquí porque la sesión no alcanzó aal2—
  // saltamos directo a pedir el código, sin volver a pedir la contraseña.
  useEffect(() => {
    async function revisarSesionExistente() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        setRevisandoSesion(false)
        return
      }
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalData && aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
        const { data: factorsData } = await supabase.auth.mfa.listFactors()
        const totp = (factorsData?.totp || []).find((f) => f.status === 'verified')
        if (totp) {
          setFactorId(totp.id)
          setPidiendoCodigo(true)
        }
      }
      setRevisandoSesion(false)
    }
    revisarSesionExistente()
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
    if (loginError) {
      setError('Correo o contraseña incorrectos.')
      setLoading(false)
      return
    }

    // ¿Esta cuenta requiere un segundo factor (TOTP)?
    const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aalError) {
      setError('No se pudo verificar el nivel de seguridad de la cuenta.')
      setLoading(false)
      return
    }

    if (aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError) {
        setError('No se pudo cargar el segundo factor de esta cuenta.')
        setLoading(false)
        return
      }
      const totp = (factorsData.totp || []).find((f) => f.status === 'verified')
      if (!totp) {
        setError('Esta cuenta requiere un segundo factor, pero no se encontró configurado.')
        setLoading(false)
        return
      }
      setFactorId(totp.id)
      setPidiendoCodigo(true)
      setLoading(false)
      return
    }

    // Sin 2FA: el login ya quedó completo (App.jsx detecta la sesión sola)
    setLoading(false)
  }

  async function handleVerificarCodigo(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) {
      setError('No se pudo iniciar la verificación. Intenta de nuevo.')
      setLoading(false)
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code: codigo,
    })

    if (verifyError) {
      setError('Código incorrecto. Verifica tu app de autenticación e intenta de nuevo.')
      setCodigo('')
      setLoading(false)
      return
    }

    // Verificado: forzamos una recarga completa para que App.jsx vuelva a
    // evaluar la sesión desde cero y confirme que ya alcanzó aal2.
    window.location.reload()
  }

  async function handleCancelarCodigo() {
    await supabase.auth.signOut()
    setPidiendoCodigo(false)
    setCodigo('')
    setFactorId(null)
    setError('')
  }

  if (revisandoSesion) {
    return <div className="container">Cargando...</div>
  }

  if (pidiendoCodigo) {
    return (
      <div className="container" style={{ maxWidth: 380, paddingTop: 80 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Verificación en dos pasos</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Ingresa el código de 6 dígitos de tu app de autenticación (Google Authenticator, Authy, etc.).
          </p>
          <form onSubmit={handleVerificarCodigo}>
            <label>Código</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
            <button className="btn" type="submit" disabled={loading || codigo.length !== 6} style={{ width: '100%' }}>
              {loading ? 'Verificando...' : 'Verificar'}
            </button>
            {error && <p className="error-msg">{error}</p>}
          </form>
          <button
            className="btn btn-secondary"
            onClick={handleCancelarCodigo}
            style={{ width: '100%', marginTop: 8 }}
          >
            Cancelar y volver
          </button>
        </div>
      </div>
    )
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
