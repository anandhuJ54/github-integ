CREATE TABLE public.exp_control_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin','architect','analyst')),
  scope_type text NOT NULL DEFAULT 'global',
  scope_id text NOT NULL DEFAULT '*',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, scope_type, scope_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_control_grants TO authenticated;
GRANT ALL ON public.exp_control_grants TO service_role;
ALTER TABLE public.exp_control_grants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_control_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exp_control_grants
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "users read own grants" ON public.exp_control_grants
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_control_role(auth.uid(), 'super_admin'));

CREATE POLICY "super admins insert grants" ON public.exp_control_grants
FOR INSERT TO authenticated
WITH CHECK (public.has_control_role(auth.uid(), 'super_admin'));

CREATE POLICY "super admins update grants" ON public.exp_control_grants
FOR UPDATE TO authenticated
USING (public.has_control_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_control_role(auth.uid(), 'super_admin'));

CREATE POLICY "super admins delete grants" ON public.exp_control_grants
FOR DELETE TO authenticated
USING (public.has_control_role(auth.uid(), 'super_admin'));

CREATE TABLE public.exp_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acting_role text,
  action text NOT NULL,
  target text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.exp_admin_audit TO authenticated;
GRANT ALL ON public.exp_admin_audit TO service_role;
ALTER TABLE public.exp_admin_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated insert own audit" ON public.exp_admin_audit
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "read own audit or super admin" ON public.exp_admin_audit
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_control_role(auth.uid(), 'super_admin'));

CREATE INDEX exp_admin_audit_created_at_idx ON public.exp_admin_audit (created_at DESC);
CREATE INDEX exp_control_grants_user_idx ON public.exp_control_grants (user_id);

-- One-time bootstrap: the first authenticated caller becomes super_admin when no grants exist.
CREATE OR REPLACE FUNCTION public.bootstrap_control_super_admin()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'unauthenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exp_control_grants) THEN
    RETURN 'already_bootstrapped';
  END IF;
  INSERT INTO public.exp_control_grants (user_id, role, is_primary)
  VALUES (v_uid, 'super_admin', true);
  INSERT INTO public.exp_admin_audit (user_id, acting_role, action, target, details)
  VALUES (v_uid, 'super_admin', 'bootstrap_super_admin', v_uid::text, '{}'::jsonb);
  RETURN 'bootstrapped';
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_control_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_control_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_control_role(uuid, text) TO authenticated;

-- Directory of admin console users, readable by super admins only (for the Users & Grants page).
CREATE OR REPLACE FUNCTION public.list_control_users()
RETURNS TABLE (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_control_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at, u.last_sign_in_at
    FROM auth.users u
    ORDER BY u.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.list_control_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_control_users() TO authenticated;