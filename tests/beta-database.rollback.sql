-- Execute on the linked Supabase project. No test records survive this transaction.
begin;
set local role service_role;
do $$
declare
  payload jsonb;
  result jsonb;
  candidate public.beta_applications;
  participant public.beta_participants;
  request_id uuid := gen_random_uuid();
  store_id uuid;
  subscription_id uuid;
  plan_id uuid;
  actor_id uuid := gen_random_uuid();
  activation timestamptz;
  ending timestamptz;
  count_before bigint;
  fingerprint text := 'rollback-test-' || gen_random_uuid();
begin
  if has_function_privilege('anon','public.submit_beta_application_atomic(jsonb,text)','execute') or has_function_privilege('authenticated','public.update_beta_application_atomic(uuid,timestamptz,text,text,text,boolean,text,uuid,text,uuid)','execute') then raise exception 'Public RPC privilege leak'; end if;
  payload := jsonb_build_object('name','Teste temporário','restaurantName','Restaurante temporário','email',request_id || '@example.invalid','source','chefos.shop','consentTerms',true,'consentMarketing',false,'consentPrivacy',true,'termsVersion','beta-terms-v1','privacyVersion','privacy-v1','requestId',request_id,'requestHash','hash-a','city','Belo Horizonte');
  result := public.submit_beta_application_atomic(payload,fingerprint);
  if (result->>'http_status')::int<>201 then raise exception 'Intake failed: %',result; end if;
  select * into candidate from public.beta_applications where id=(result->>'id')::uuid;
  if candidate.city<>'Belo Horizonte' or candidate.consent_privacy is not true or candidate.consent_marketing is not false then raise exception 'Candidate metadata/consents lost'; end if;
  if (select count(*) from public.beta_consent_events where application_id=candidate.id)<>3 then raise exception 'Incomplete consent journal'; end if;
  result := public.submit_beta_application_atomic(payload,fingerprint);
  if (result->>'http_status')::int<>200 or (select count(*) from public.beta_consent_events where application_id=candidate.id)<>3 then raise exception 'Retry duplicated data'; end if;
  result := public.submit_beta_application_atomic(payload || '{"requestHash":"hash-b"}',fingerprint);
  if (result->>'http_status')::int<>409 then raise exception 'Changed retry not blocked'; end if;
  result := public.submit_beta_application_atomic(payload || jsonb_build_object('requestId',gen_random_uuid()),fingerprint);
  if (result->>'http_status')::int<>409 then raise exception 'Duplicate active email not blocked'; end if;
  for i in 1..3 loop
    result := public.submit_beta_application_atomic(payload || jsonb_build_object('requestId',gen_random_uuid()),fingerprint);
  end loop;
  result := public.submit_beta_application_atomic(payload || jsonb_build_object('requestId',gen_random_uuid()),fingerprint);
  if (result->>'http_status')::int<>429 then raise exception 'Rate limit not enforced'; end if;
  -- Setting up an approved fixture is test preparation, not a public workflow shortcut.
  update public.beta_applications set status='approved' where id=candidate.id returning * into candidate;
  perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'onboarding','Preparação',null,false,null,actor_id,'test@example.invalid');
  select * into candidate from public.beta_applications where id=candidate.id;
  select * into participant from public.beta_participants where application_id=candidate.id;
  if participant.activated_at is not null or participant.beta_ends_at is not null then raise exception 'Clock started during onboarding'; end if;
  select count(*) into count_before from public.beta_application_events where application_id=candidate.id;
  begin
    perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'active','Ativação',null,false,null,actor_id,'test@example.invalid');
    raise exception 'Unlinked activation allowed';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.beta_applications where id=candidate.id)<>'onboarding' or (select count(*) from public.beta_application_events where application_id=candidate.id)<>count_before then raise exception 'Failed transition partially committed'; end if;
  select id into plan_id from public.plans order by created_at limit 1;
  if plan_id is null then raise exception 'No plan available for isolated fixture'; end if;
  insert into public.stores(name) values('Rollback-only beta fixture') returning id into store_id;
  insert into public.subscriptions(user_id,plan_id,status,current_period_end) values(store_id,plan_id,'trialing',now()+interval '3 days') returning id into subscription_id;
  perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'onboarding','Vínculo',null,false,null,actor_id,'test@example.invalid',store_id);
  select * into candidate from public.beta_applications where id=candidate.id;
  perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'active','Ativação',null,false,null,actor_id,'test@example.invalid');
  select * into candidate from public.beta_applications where id=candidate.id;
  select * into participant from public.beta_participants where application_id=candidate.id;
  activation := participant.activated_at;
  ending := participant.beta_ends_at;
  if ending-activation<>interval '90 days' or ending is distinct from (select current_period_end from public.subscriptions where id=subscription_id) then raise exception 'Subscription and beta clock disagree'; end if;
  perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'active','Acompanhamento',null,false,'cohort-test',actor_id,'test@example.invalid');
  if (select beta_ends_at from public.beta_participants where application_id=candidate.id) is distinct from ending then raise exception 'Retry extended beta'; end if;
  begin
    perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'active','Versão antiga',null,false,null,actor_id,'test@example.invalid');
    raise exception 'Stale version allowed';
  exception when serialization_failure then null;
  end;
  select * into candidate from public.beta_applications where id=candidate.id;
  perform public.update_beta_application_atomic(candidate.id,candidate.updated_at,'closed','Encerramento',null,false,null,actor_id,'test@example.invalid');
  if (select status from public.subscriptions where id=subscription_id)<>'canceled' then raise exception 'Closed beta retained trial access'; end if;
end $$;
select 'PASS: intake, consent, retries, duplicate, rate limit, server-only RPC, atomic failure, activation, subscription, preserved expiry, concurrency and closure' as verification;
rollback;
