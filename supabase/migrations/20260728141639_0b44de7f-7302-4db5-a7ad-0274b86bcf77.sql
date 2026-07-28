CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  category text NOT NULL DEFAULT 'admin',
  target_id uuid,
  target_email text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON public.audit_logs FOR SELECT TO authenticated USING (public.is_elevated(auth.uid()));

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_category_idx ON public.audit_logs (category);

CREATE TABLE public.incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  stack text,
  route text,
  severity text NOT NULL DEFAULT 'error',
  source text NOT NULL DEFAULT 'client',
  user_id uuid,
  user_email text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.incident_reports TO authenticated;
GRANT ALL ON public.incident_reports TO service_role;
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_select ON public.incident_reports FOR SELECT TO authenticated USING (public.is_elevated(auth.uid()));

CREATE INDEX incident_reports_created_at_idx ON public.incident_reports (created_at DESC);
CREATE INDEX incident_reports_resolved_idx ON public.incident_reports (resolved);

ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_reports;