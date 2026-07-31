-- 1. Retire Board Member
CREATE OR REPLACE FUNCTION private.is_committee(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('super_admin','president','treasurer')
  ) AND (auth.uid() IS NULL OR _user_id = auth.uid());
$function$;

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'resident'::app_role FROM public.user_roles WHERE role::text = 'board_member'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles WHERE role::text = 'board_member';

-- 2. Ownership rules for the private receipts bucket
DROP POLICY IF EXISTS "receipts_read_own_or_committee" ON storage.objects;
DROP POLICY IF EXISTS "receipts_insert_elevated" ON storage.objects;
DROP POLICY IF EXISTS "receipts_update_elevated" ON storage.objects;
DROP POLICY IF EXISTS "receipts_delete_elevated" ON storage.objects;

CREATE POLICY "receipts_read_own_or_committee"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR private.is_committee(auth.uid())
  )
);

CREATE POLICY "receipts_insert_elevated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'receipts' AND private.is_elevated(auth.uid()));

CREATE POLICY "receipts_update_elevated"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'receipts' AND private.is_elevated(auth.uid()))
WITH CHECK (bucket_id = 'receipts' AND private.is_elevated(auth.uid()));

CREATE POLICY "receipts_delete_elevated"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'receipts' AND private.is_elevated(auth.uid()));