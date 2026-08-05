import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import OTDetail from './pages/OTDetail'
import Portal from './pages/Portal'
import AdminHerramientas from './pages/AdminHerramientas'
import Buscador from './pages/Buscador'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Nivel de verificación de la sesión (2FA). checkingAal evita mostrar
  // el Portal por una fracción de segundo antes de confirmar si falta el
  // segundo factor.
  const [aalOk, setAalOk] = useState(true)
  const [checkingAal, setCheckingAal] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Cada vez que cambia la sesión, verificamos si ya alcanzó el nivel de
  // seguridad requerido (aal2) o si aún falta el código de 2FA.
  useEffect(() => {
    async function checkAal() {
      if (!session) {
        setAalOk(true)
        setCheckingAal(false)
        return
      }
      setCheckingAal(true)
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) {
        setAalOk(true)
        setCheckingAal(false)
        return
      }
      const requiereSegundoFactor = data.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
      setAalOk(!requiereSegundoFactor)
      setCheckingAal(false)
    }
    checkAal()
  }, [session])

  useEffect(() => {
    async function loadProfile() {
      if (!session?.user) { setProfile(null); return }
      const { data } = await supabase
        .from('profiles')
        .select('id, area, full_name')
        .eq('id', session.user.id)
        .maybeSingle()
      setProfile(data)
    }
    loadProfile()
  }, [session])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (loading) return <div className="container">Cargando...</div>
  if (!session) return <Login />
  if (checkingAal) return <div className="container">Verificando seguridad de la cuenta...</div>
  if (!aalOk) return <Login />
  if (!profile) return <div className="container">No se encontró tu perfil. Contacta al administrador.</div>
  if (!profile.area) return <div className="container">Tu cuenta no tiene un área asignada. Contacta al administrador.</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Portal profile={profile} onLogout={handleLogout} />} />
        <Route path="/ots" element={<Dashboard profile={profile} onLogout={handleLogout} />} />
        <Route path="/ot/:otNumber" element={<OTDetail profile={profile} />} />
        <Route path="/admin/herramientas" element={<AdminHerramientas profile={profile} onLogout={handleLogout} />} />
        <Route path="/buscar" element={<Buscador profile={profile} onLogout={handleLogout} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
