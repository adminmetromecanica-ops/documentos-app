-- 1. Agregar columna 'area' a profiles (si no existe ya)
alter table profiles add column if not exists area text
  check (area in ('laboratorio','contabilidad','comercial','logistica','gerencia'));

-- 2. Asignar áreas a los usuarios existentes (AJUSTA los correos reales)
-- update profiles set area = 'laboratorio' where id = (select id from auth.users where email = 'correo_laboratorio@metromecanica.com.pe');
-- update profiles set area = 'contabilidad' where id = (select id from auth.users where email = 'correo_contabilidad@metromecanica.com.pe');
-- update profiles set area = 'comercial' where id = (select id from auth.users where email = 'correo_comercial@metromecanica.com.pe');
-- update profiles set area = 'logistica' where id = (select id from auth.users where email = 'correo_logistica@metromecanica.com.pe');
-- update profiles set area = 'gerencia' where id = (select id from auth.users where email = 'tu_correo@metromecanica.com.pe');

-- 3. Habilitar RLS en documentos
alter table documentos enable row level security;

-- 4. Política de lectura: cada usuario ve solo documentos de su área, gerencia ve todo
create policy "ver_documentos_propia_area"
on documentos for select
to authenticated
using (
  area = (select p.area from profiles p where p.id = auth.uid())
  or (select p.area from profiles p where p.id = auth.uid()) = 'gerencia'
);

-- 5. Insert lo maneja n8n con la service_role key (bypassa RLS), así que
-- no necesitamos política de insert para usuarios autenticados directos.
-- Si en el futuro quieres permitir insert directo desde el frontend, se agregaría aquí.
