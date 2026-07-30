CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;
ALTER FUNCTION public.is_committee(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_elevated(uuid) SET SCHEMA private;

ALTER FUNCTION private.has_role(uuid, public.app_role) SET search_path = public;
ALTER FUNCTION private.is_committee(uuid) SET search_path = public;
ALTER FUNCTION private.is_elevated(uuid) SET search_path = public;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_committee(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_elevated(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_committee(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_elevated(uuid) TO authenticated, service_role;