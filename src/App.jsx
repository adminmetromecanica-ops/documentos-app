import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import OTDetail from './pages/OTDetail'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
  if (!profile) return <div className="container">No se encontró tu perfil. Contacta al administrador.</div>
  if (!profile.area) return <div className="container">Tu cuenta no tiene un área asignada. Contacta al administrador.</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard profile={profile} onLogout={handleLogout} />} />
        <Route path="/ot/:otNumber" element={<OTDetail profile={profile} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
