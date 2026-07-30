-- 1. Treasurer role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasurer';

-- 2. Profile privacy + notification preferences
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hide_flat_no boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_announcements boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mfa_enrolled boolean NOT NULL DEFAULT false;

-- 3. Role helpers (text comparison so the new enum value is safe in this transaction)
CREATE OR REPLACE FUNCTION private.is_supreme(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('super_admin','treasurer')
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.is_elevated(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('super_admin','president','treasurer')
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.is_committee(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('super_admin','president','treasurer','board_member')
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION private.is_supreme(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_supreme(uuid) TO authenticated, service_role;

-- 4. Raw profile rows (incl. flat numbers) readable only by the owner or supreme roles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING ((id = auth.uid()) OR private.is_supreme(auth.uid()));

-- 5. Residents directory with flat-number masking
CREATE OR REPLACE VIEW public.residents_directory
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.phone,
  CASE
    WHEN p.hide_flat_no AND p.id <> auth.uid() AND NOT private.is_supreme(auth.uid())
      THEN NULL
    ELSE p.flat_no
  END AS flat_no,
  p.hide_flat_no,
  p.created_at
FROM public.profiles p
WHERE private.is_committee(auth.uid()) OR p.id = auth.uid();

GRANT SELECT ON public.residents_directory TO authenticated;

-- 6. Session activity for backend-enforced 30 minute idle expiry
CREATE TABLE IF NOT EXISTS public.session_activity (
  user_id uuid PRIMARY KEY,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  expired_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.session_activity TO authenticated;
GRANT ALL ON public.session_activity TO service_role;
ALTER TABLE public.session_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_activity_select_own ON public.session_activity;
CREATE POLICY session_activity_select_own ON public.session_activity
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_elevated(auth.uid()));
DROP TRIGGER IF EXISTS touch_session_activity ON public.session_activity;
CREATE TRIGGER touch_session_activity BEFORE UPDATE ON public.session_activity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 7. Receipts issued by the committee to residents
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  period text,
  note text,
  file_path text,
  file_name text,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts TO authenticated;
GRANT ALL ON public.receipts TO service_role;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipts_select ON public.receipts;
CREATE POLICY receipts_select ON public.receipts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_committee(auth.uid()));

DROP POLICY IF EXISTS receipts_insert ON public.receipts;
CREATE POLICY receipts_insert ON public.receipts
  FOR INSERT TO authenticated
  WITH CHECK (private.is_elevated(auth.uid()));

DROP POLICY IF EXISTS receipts_update ON public.receipts;
CREATE POLICY receipts_update ON public.receipts
  FOR UPDATE TO authenticated
  USING (private.is_elevated(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (private.is_elevated(auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS receipts_delete ON public.receipts;
CREATE POLICY receipts_delete ON public.receipts
  FOR DELETE TO authenticated
  USING (private.is_elevated(auth.uid()));

DROP TRIGGER IF EXISTS touch_receipts ON public.receipts;
CREATE TRIGGER touch_receipts BEFORE UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS receipts_user_idx ON public.receipts(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx ON public.audit_logs(action, created_at DESC);