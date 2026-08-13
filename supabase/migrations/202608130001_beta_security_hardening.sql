-- Migration: 202608130001_beta_security_hardening.sql
-- Phase 2 hardening for the ChefOS beta intake pipeline and public profile projection.

-- 1. Public profile view should respect the caller's permissions on the underlying tables.
ALTER VIEW IF EXISTS public.company_profile_public SET (security_invoker = true);

-- 2. Performance fix for consent lookups by application.
CREATE INDEX IF NOT EXISTS beta_consent_events_application_idx
  ON public.beta_consent_events (application_id, created_at DESC);

-- 3. Explicit service-role policies for the new beta pipeline tables.
DROP POLICY IF EXISTS "Service role full access beta_applications" ON public.beta_applications;
CREATE POLICY "Service role full access beta_applications"
  ON public.beta_applications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access beta_application_events" ON public.beta_application_events;
CREATE POLICY "Service role full access beta_application_events"
  ON public.beta_application_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access beta_participants" ON public.beta_participants;
CREATE POLICY "Service role full access beta_participants"
  ON public.beta_participants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access beta_consent_events" ON public.beta_consent_events;
CREATE POLICY "Service role full access beta_consent_events"
  ON public.beta_consent_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access beta_submission_attempts" ON public.beta_submission_attempts;
CREATE POLICY "Service role full access beta_submission_attempts"
  ON public.beta_submission_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Keep the service role grants explicit for the beta tables.
REVOKE ALL ON public.beta_applications, public.beta_application_events, public.beta_participants, public.beta_consent_events, public.beta_submission_attempts FROM anon, authenticated;

GRANT ALL ON public.beta_applications TO service_role;
GRANT ALL ON public.beta_application_events TO service_role;
GRANT ALL ON public.beta_participants TO service_role;
GRANT ALL ON public.beta_consent_events TO service_role;
GRANT ALL ON public.beta_submission_attempts TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.beta_applications TO service_role;
GRANT SELECT, INSERT ON public.beta_application_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.beta_participants TO service_role;
GRANT SELECT, INSERT ON public.beta_consent_events TO service_role;
GRANT SELECT, INSERT, DELETE ON public.beta_submission_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.beta_submission_attempts_id_seq TO service_role;
