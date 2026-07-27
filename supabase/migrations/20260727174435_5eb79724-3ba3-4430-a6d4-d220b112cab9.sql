
-- ROLES
CREATE TYPE public.app_role AS ENUM ('super_admin', 'president', 'board_member', 'resident');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  flat_no text,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- any committee member (can post announcements)
CREATE OR REPLACE FUNCTION public.is_committee(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','president','board_member')
  );
$$;

-- elevated: manage dues / submissions / requests
CREATE OR REPLACE FUNCTION public.is_elevated(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','president')
  );
$$;

-- PROFILES policies
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_committee(auth.uid()));
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_elevated(auth.uid()))
  WITH CHECK (id = auth.uid() OR public.is_elevated(auth.uid()));
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- USER ROLES policies (read only for clients; writes go through service role)
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_committee(auth.uid()));

-- MAINTENANCE
CREATE TABLE public.maintenance_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  due_date date,
  status text NOT NULL DEFAULT 'unpaid',
  paid_at timestamptz,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_status_chk CHECK (status IN ('paid','unpaid','partial'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_dues TO authenticated;
GRANT ALL ON public.maintenance_dues TO service_role;
ALTER TABLE public.maintenance_dues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dues_select" ON public.maintenance_dues FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_committee(auth.uid()));
CREATE POLICY "dues_insert" ON public.maintenance_dues FOR INSERT TO authenticated
  WITH CHECK (public.is_elevated(auth.uid()));
CREATE POLICY "dues_update" ON public.maintenance_dues FOR UPDATE TO authenticated
  USING (public.is_elevated(auth.uid())) WITH CHECK (public.is_elevated(auth.uid()));
CREATE POLICY "dues_delete" ON public.maintenance_dues FOR DELETE TO authenticated
  USING (public.is_elevated(auth.uid()));

-- SUBMISSION REQUESTS
CREATE TABLE public.submission_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  due_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submission_requests TO authenticated;
GRANT ALL ON public.submission_requests TO service_role;
ALTER TABLE public.submission_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sr_select" ON public.submission_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "sr_insert" ON public.submission_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_elevated(auth.uid()));
CREATE POLICY "sr_update" ON public.submission_requests FOR UPDATE TO authenticated
  USING (public.is_elevated(auth.uid())) WITH CHECK (public.is_elevated(auth.uid()));
CREATE POLICY "sr_delete" ON public.submission_requests FOR DELETE TO authenticated
  USING (public.is_elevated(auth.uid()));

-- SUBMISSIONS
CREATE TABLE public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.submission_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submitted boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submissions TO authenticated;
GRANT ALL ON public.submissions TO service_role;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_select" ON public.submissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_committee(auth.uid()));
CREATE POLICY "sub_insert" ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (public.is_elevated(auth.uid()));
CREATE POLICY "sub_update" ON public.submissions FOR UPDATE TO authenticated
  USING (public.is_elevated(auth.uid())) WITH CHECK (public.is_elevated(auth.uid()));
CREATE POLICY "sub_delete" ON public.submissions FOR DELETE TO authenticated
  USING (public.is_elevated(auth.uid()));

-- ANNOUNCEMENTS
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  importance text NOT NULL DEFAULT 'normal',
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text,
  author_role public.app_role,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_importance_chk CHECK (importance IN ('normal','important','urgent'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ann_select" ON public.announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY "ann_insert" ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (public.is_committee(auth.uid()) AND author_id = auth.uid());
CREATE POLICY "ann_update" ON public.announcements FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_elevated(auth.uid()))
  WITH CHECK (author_id = auth.uid() OR public.is_elevated(auth.uid()));
CREATE POLICY "ann_delete" ON public.announcements FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_elevated(auth.uid()));

-- updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_dues_touch BEFORE UPDATE ON public.maintenance_dues
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sub_touch BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- new user -> profile + resident role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, flat_no, phone, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'flat_no', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'resident')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- bootstrap the super admin only for the verified owner email
CREATE OR REPLACE FUNCTION public.grant_super_admin_for_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) = 'mickeybanerjee29@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'super_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created_owner
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_super_admin_for_owner();

CREATE TRIGGER on_auth_user_confirmed_owner
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_super_admin_for_owner();

ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
