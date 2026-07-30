DROP VIEW IF EXISTS public.residents_directory;

CREATE OR REPLACE FUNCTION public.residents_directory()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  phone text,
  flat_no text,
  hide_flat_no boolean,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  WHERE auth.uid() IS NOT NULL
    AND (private.is_committee(auth.uid()) OR p.id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.residents_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.residents_directory() TO authenticated, service_role;