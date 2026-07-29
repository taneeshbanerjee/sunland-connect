-- 1. Stop broadcasting sensitive incident data over realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.incident_reports;

-- 2. Harden SECURITY DEFINER role helpers: callers may only check themselves
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_committee(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','president','board_member')
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_elevated(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','president')
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$$;

-- 3. Internal trigger helpers must never be callable from the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_super_admin_for_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_committee(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_elevated(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_committee(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_elevated(uuid) TO authenticated, service_role;