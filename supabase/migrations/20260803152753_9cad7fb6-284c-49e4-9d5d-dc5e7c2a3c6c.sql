DROP FUNCTION IF EXISTS public.delete_resident(uuid);
DROP FUNCTION IF EXISTS public.residents_directory();

DROP POLICY IF EXISTS reports_insert_anyone ON public.reports;
CREATE POLICY reports_insert_anyone ON public.reports
FOR INSERT TO anon, authenticated
WITH CHECK (
  (auth.uid() IS NULL AND user_id IS NULL)
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);