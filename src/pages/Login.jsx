import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// ── Dispositivo de confianza ────────────────────────────────────────────
// Después de verificar el código del correo, el usuario puede marcar
// "Recordar este equipo por 30 días". Mientras no venza, en esa PC solo
// se pide correo + contraseña (sin código). Se guarda por correo.
const CLAVE_CONFIANZA = 'mm_dispositivos_confiables'
const DIAS_CONFIANZA = 30

function leerConfianza() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_CONFIANZA) || '{}')
  } catch {
    return {}
  }
}

function esDispositivoConfiable(email) {
  const vence = leerConfianza()[email]
  return typeof vence === 'number' && vence > Date.now()
}

function marcarDispositivoConfiable(email) {
  try {
    const datos = leerConfianza()
    datos[email] = Date.now() + DIAS_CONFIANZA * 24 * 60 * 60 * 1000
    localStorage.setItem(CLAVE_CONFIANZA, JSON.stringify(datos))
  } catch {
    // Si el navegador no permite guardar, simplemente pedirá código la próxima vez
  }
}

const SEGUNDOS_REENVIO = 60

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [loading, setLoading] = useState(false)

  // Paso 2: código de 6 dígitos enviado al correo del usuario
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [espera, setEspera] = useState(0)

  // Cuenta regresiva para el botón "Reenviar código"
  useEffect(() => {
    if (espera <= 0) return
    const t = setTimeout(() => setEspera((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [espera])

  function correoNormalizado() {
    return email.trim().toLowerCase()
  }

  async function enviarCodigo(correo) {
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: correo,
      options: { shouldCreateUser: false },
    })
    if (otpError) {
      if (otpError.status === 429 || /rate|seconds/i.test(otpError.message || '')) {
        setError('Espera un minuto antes de pedir otro código.')
      } else {
        setError('No se pudo enviar el código al correo. Intenta de nuevo.')
      }
      return false
    }
    setEspera(SEGUNDOS_REENVIO)
    return true
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setAviso('')
    setLoading(true)
    const correo = correoNormalizado()

    // 1) Validar la contraseña
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: correo, password })
    if (loginError) {
      setError('Correo o contraseña incorrectos.')
      setLoading(false)
      return
    }

    // 2) Equipo de confianza vigente: la sesión ya quedó abierta, App.jsx la detecta sola
    if (esDispositivoConfiable(correo)) {
      setLoading(false)
      return
    }

    // 3) Equipo nuevo o vencido: cerramos esta sesión y enviamos el código al correo.
    //    La sesión definitiva solo se abre cuando el código es correcto.
    await supabase.auth.signOut({ scope: 'local' })
    const enviado = await enviarCodigo(correo)
    if (enviado) {
      setPidiendoCodigo(true)
      setAviso(`Enviamos un código de 6 dígitos a ${correo}.`)
    }
    setLoading(false)
  }

  async function handleVerificarCodigo(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const correo = correoNormalizado()

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: correo,
      token: codigo,
      type: 'email',
    })

    if (verifyError) {
      setError('Código incorrecto o vencido. Revisa el último correo recibido o pide uno nuevo.')
      setCodigo('')
      setLoading(false)
      return
    }

    if (recordar) marcarDispositivoConfiable(correo)

    // Verificado: recarga completa para que App.jsx evalúe la sesión desde cero
    window.location.reload()
  }

  async function handleReenviar() {
    setError('')
    setAviso('')
    setLoading(true)
    const enviado = await enviarCodigo(correoNormalizado())
    if (enviado) setAviso('Te enviamos un código nuevo. Usa solo el más reciente.')
    setLoading(false)
  }

  function handleCancelarCodigo() {
    setPidiendoCodigo(false)
    setCodigo('')
    setPassword('')
    setError('')
    setAviso('')
  }

  if (pidiendoCodigo) {
    return (
      <div className="container" style={{ maxWidth: 380, paddingTop: 80 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Verificación en dos pasos</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Ingresa el código de 6 dígitos que llegó a <strong>{correoNormalizado()}</strong>.
            Revisa también la carpeta de spam.
          </p>
          <form onSubmit={handleVerificarCodigo}>
            <label>Código</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, margin: '8px 0 12px' }}>
              <input
                type="checkbox"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
                style={{ width: 'auto', margin: 0 }}
              />
              Recordar este equipo por {DIAS_CONFIANZA} días
            </label>
            <button className="btn" type="submit" disabled={loading || codigo.length !== 6} style={{ width: '100%' }}>
              {loading ? 'Verificando...' : 'Verificar'}
            </button>
            {aviso && !error && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{aviso}</p>}
            {error && <p className="error-msg">{error}</p>}
          </form>
          <button
            className="btn btn-secondary"
            onClick={handleReenviar}
            disabled={loading || espera > 0}
            style={{ width: '100%', marginTop: 8 }}
          >
            {espera > 0 ? `Reenviar código (${espera} s)` : 'Reenviar código'}
          </button>
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
