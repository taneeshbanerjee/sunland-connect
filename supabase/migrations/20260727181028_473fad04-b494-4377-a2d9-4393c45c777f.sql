INSERT INTO public.profiles (id, full_name, flat_no, phone, email)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name',''), NULLIF(u.raw_user_meta_data->>'flat_no',''), NULLIF(u.raw_user_meta_data->>'phone',''), u.email
FROM auth.users u WHERE lower(u.email)='mickeybanerjee29@gmail.com'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'resident'::app_role FROM auth.users u WHERE lower(u.email)='mickeybanerjee29@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'super_admin'::app_role FROM auth.users u WHERE lower(u.email)='mickeybanerjee29@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;