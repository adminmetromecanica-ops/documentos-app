import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabaseClient'

// ── Dispositivo de confianza ────────────────────────────────────────────
// Después de verificar el código del correo, el usuario puede marcar
// "Recordar este equipo por 30 días". Mientras no venza, en esa PC solo
// se pide correo + contraseña (sin código). Se guarda por correo.
const CLAVE_CONFIANZA = 'mm_dispositivos_confiables'
const DIAS_CONFIANZA = 30
const SEGUNDOS_REENVIO = 60

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

// ── Estado del flujo, FUERA del componente ──────────────────────────────
// Al validar la contraseña, Supabase abre una sesión por un instante y
// App.jsx desmonta/monta de nuevo este componente. Si el estado viviera
// dentro del componente (useState) se perdería y volvería a aparecer el
// formulario de correo/contraseña. Por eso se guarda a nivel de módulo.
//   fase: 'credenciales' | 'enviando' | 'codigo'
let flujo = { fase: 'credenciales', email: '', error: '', aviso: '', enviadoEn: 0 }
const suscriptores = new Set()

function setFlujo(cambios) {
  flujo = { ...flujo, ...cambios }
  suscriptores.forEach((fn) => fn())
}

function suscribir(fn) {
  suscriptores.add(fn)
  return () => suscriptores.delete(fn)
}

function useFlujo() {
  return useSyncExternalStore(suscribir, () => flujo)
}

async function enviarCodigo(correo) {
  const { error } = await supabase.auth.signInWithOtp({
    email: correo,
    options: { shouldCreateUser: false },
  })
  if (error) {
    const esLimite = error.status === 429 || /rate|seconds/i.test(error.message || '')
    return esLimite
      ? 'Espera un minuto antes de pedir otro código.'
      : 'No se pudo enviar el código al correo. Intenta de nuevo.'
  }
  return null
}

export default function Login() {
  const estado = useFlujo()
  const [email, setEmail] = useState(estado.email)
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [verificando, setVerificando] = useState(false)
  const [ahora, setAhora] = useState(Date.now())

  // Reloj para la cuenta regresiva del botón "Reenviar código"
  useEffect(() => {
    if (estado.fase !== 'codigo') return
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [estado.fase])

  const espera = Math.max(0, Math.ceil((estado.enviadoEn + SEGUNDOS_REENVIO * 1000 - ahora) / 1000))

  async function handleLogin(e) {
    e.preventDefault()
    const correo = email.trim().toLowerCase()
    setFlujo({ fase: 'enviando', email: correo, error: '', aviso: '' })

    // 1) Validar la contraseña
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: correo, password })
    if (loginError) {
      setFlujo({ fase: 'credenciales', error: 'Correo o contraseña incorrectos.' })
      return
    }

    // 2) Equipo de confianza vigente: la sesión queda abierta y App.jsx entra sola
    if (esDispositivoConfiable(correo)) {
      setFlujo({ fase: 'credenciales', error: '', aviso: '' })
      return
    }

    // 3) Equipo nuevo o vencido: cerramos esa sesión y enviamos el código al correo.
    //    La sesión definitiva solo se abre cuando el código es correcto.
    await supabase.auth.signOut({ scope: 'local' })
    const errorEnvio = await enviarCodigo(correo)
    if (errorEnvio) {
      setFlujo({ fase: 'credenciales', error: errorEnvio })
      return
    }
    setFlujo({
      fase: 'codigo',
      error: '',
      aviso: `Enviamos un código de 6 dígitos a ${correo}.`,
      enviadoEn: Date.now(),
    })
  }

  async function handleVerificarCodigo(e) {
    e.preventDefault()
    setVerificando(true)
    setFlujo({ error: '' })

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: estado.email,
      token: codigo,
      type: 'email',
    })

    if (verifyError) {
      setFlujo({ error: 'Código incorrecto o vencido. Revisa el último correo recibido o pide uno nuevo.' })
      setCodigo('')
      setVerificando(false)
      return
    }

    if (recordar) marcarDispositivoConfiable(estado.email)
    setFlujo({ fase: 'credenciales', error: '', aviso: '', enviadoEn: 0 })

    // Verificado: recarga completa para que App.jsx evalúe la sesión desde cero
    window.location.reload()
  }

  async function handleReenviar() {
    setVerificando(true)
    setFlujo({ error: '', aviso: '' })
    const errorEnvio = await enviarCodigo(estado.email)
    if (errorEnvio) {
      setFlujo({ error: errorEnvio })
    } else {
      setFlujo({ aviso: 'Te enviamos un código nuevo. Usa solo el más reciente.', enviadoEn: Date.now() })
      setAhora(Date.now())
    }
    setVerificando(false)
  }

  function handleCancelarCodigo() {
    setFlujo({ fase: 'credenciales', error: '', aviso: '', enviadoEn: 0 })
    setCodigo('')
    setPassword('')
  }

  if (estado.fase === 'codigo') {
    return (
      <div className="container" style={{ maxWidth: 380, paddingTop: 80 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Verificación en dos pasos</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Ingresa el código de 6 dígitos que llegó a <strong>{estado.email}</strong>.
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
            <button className="btn" type="submit" disabled={verificando || codigo.length !== 6} style={{ width: '100%' }}>
              {verificando ? 'Verificando...' : 'Verificar'}
            </button>
            {estado.aviso && !estado.error && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{estado.aviso}</p>
            )}
            {estado.error && <p className="error-msg">{estado.error}</p>}
          </form>
          <button
            className="btn btn-secondary"
            onClick={handleReenviar}
            disabled={verificando || espera > 0}
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

  const enviando = estado.fase === 'enviando'

  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 80 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Metromecanica — Documentos</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Ingresa con tu cuenta para ver y subir los documentos de tu área.
        </p>
        <form onSubmit={handleLogin}>
          <label>Correo</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={enviando} required />
          <label>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={enviando}
            required={!enviando}
          />
          <button className="btn" type="submit" disabled={enviando} style={{ width: '100%' }}>
            {enviando ? 'Enviando código al correo...' : 'Ingresar'}
          </button>
          {estado.error && <p className="error-msg">{estado.error}</p>}
        </form>
      </div>
    </div>
  )
}
