-- 1. Reports inbox (public submission)
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  category text NOT NULL DEFAULT 'general',
  subject text NOT NULL,
  message text NOT NULL,
  user_id uuid,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_insert_anyone ON public.reports
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY reports_select_elevated ON public.reports
  FOR SELECT TO authenticated USING (private.is_elevated(auth.uid()) OR user_id = auth.uid());
CREATE POLICY reports_update_elevated ON public.reports
  FOR UPDATE TO authenticated USING (private.is_elevated(auth.uid())) WITH CHECK (private.is_elevated(auth.uid()));
CREATE POLICY reports_delete_elevated ON public.reports
  FOR DELETE TO authenticated USING (private.is_elevated(auth.uid()));

CREATE TRIGGER reports_touch BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Payment request on submissions
ALTER TABLE public.submission_requests
  ADD COLUMN IF NOT EXISTS payment_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_amount numeric;

-- 3. Profiles delete policy (never a super admin)
DROP POLICY IF EXISTS profiles_delete_elevated ON public.profiles;
CREATE POLICY profiles_delete_elevated ON public.profiles
  FOR DELETE TO authenticated
  USING (
    private.is_elevated(auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = public.profiles.id AND ur.role = 'super_admin'
    )
  );

-- 4. SECURITY DEFINER delete-resident tool
CREATE OR REPLACE FUNCTION public.delete_resident(_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _caller_ok boolean;
  _target_super boolean;
  _target_elevated boolean;
  _caller_super boolean;
  _email text;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF _caller = _target THEN
    RAISE EXCEPTION 'You cannot remove your own account';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _caller AND role IN ('super_admin','treasurer','president')
  ) INTO _caller_ok;
  IF NOT _caller_ok THEN
    RAISE EXCEPTION 'Forbidden: you cannot remove residents';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _caller AND role = 'super_admin')
    INTO _caller_super;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _target AND role = 'super_admin')
    INTO _target_super;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _target AND role IN ('treasurer','president')
  ) INTO _target_elevated;

  IF _target_super THEN
    RAISE EXCEPTION 'The Super Admin cannot be removed from the residency database';
  END IF;
  IF _target_elevated AND NOT _caller_super THEN
    RAISE EXCEPTION 'Only the Super Admin can remove another committee role holder';
  END IF;

  SELECT email INTO _email FROM public.profiles WHERE id = _target;

  DELETE FROM public.maintenance_dues WHERE user_id = _target;
  DELETE FROM public.submissions WHERE user_id = _target;
  DELETE FROM public.receipts WHERE user_id = _target;
  DELETE FROM public.session_activity WHERE user_id = _target;
  DELETE FROM public.user_roles WHERE user_id = _target;
  UPDATE public.announcements SET author_id = NULL WHERE author_id = _target;
  DELETE FROM public.profiles WHERE id = _target;
  -- Revoke sign-in permanently: the auth account itself is removed.
  DELETE FROM auth.users WHERE id = _target;

  INSERT INTO public.audit_logs (actor_id, action, category, target_id, target_email, details, success)
  VALUES (_caller, 'resident_removed', 'admin', _target, _email,
          jsonb_build_object('auth_account_deleted', true), true);

  RETURN jsonb_build_object('ok', true, 'email', _email);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_resident(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_resident(uuid) TO authenticated;