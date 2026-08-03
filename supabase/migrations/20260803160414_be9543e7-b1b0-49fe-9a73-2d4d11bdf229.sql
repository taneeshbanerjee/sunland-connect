CREATE TABLE public.login_lockouts (
  email text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.login_lockouts TO service_role;
ALTER TABLE public.login_lockouts ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (server code) may touch this table.

CREATE TRIGGER trg_login_lockouts_touch BEFORE UPDATE ON public.login_lockouts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  context text NOT NULL,
  reference_id uuid,
  amount numeric(12,2),
  note text,
  status text NOT NULL DEFAULT 'initiated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_status_check CHECK (status IN ('initiated','opened','abandoned')),
  CONSTRAINT payment_intents_key_unique UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idx_payment_intents_user_recent ON public.payment_intents (user_id, created_at DESC);

GRANT SELECT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read their own payment attempts"
ON public.payment_intents FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER trg_payment_intents_touch BEFORE UPDATE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();