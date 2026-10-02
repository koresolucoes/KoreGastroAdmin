begin;
alter table public.beta_applications
  add column if not exists city text,
  add column if not exists neighborhood text,
  add column if not exists equipment text,
  add column if not exists campaign jsonb not null default '{}'::jsonb,
  add column if not exists consent_privacy boolean,
  add column if not exists privacy_version text,
  add column if not exists request_id uuid,
  add column if not exists request_hash text;
create unique index if not exists beta_application_request_key on public.beta_applications(request_id) where request_id is not null;
alter table public.beta_consent_events drop constraint beta_consent_events_type_check;
alter table public.beta_consent_events add constraint beta_consent_events_type_check check(consent_type in ('program_terms','privacy','marketing'));
alter table public.beta_participants
  add column if not exists store_id uuid references public.stores(id),
  add column if not exists subscription_id uuid references public.subscriptions(id);
create unique index if not exists beta_participant_store_open_key on public.beta_participants(store_id) where store_id is not null and status in ('onboarding','active');
create index if not exists beta_participant_subscription_idx on public.beta_participants(subscription_id) where subscription_id is not null;

-- Only the server can call this function. All writes commit or roll back together.
create or replace function public.submit_beta_application_atomic(p_payload jsonb, p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  candidate public.beta_applications;
  request_uuid uuid := nullif(p_payload->>'requestId','')::uuid;
  email_value text := lower(trim(p_payload->>'email'));
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('beta-ip:' || p_fingerprint, 0));
  if request_uuid is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('beta-request:' || request_uuid::text, 0));
    select * into candidate from public.beta_applications where request_id=request_uuid;
    if found then
      if candidate.request_hash is distinct from p_payload->>'requestHash' then return jsonb_build_object('http_status',409,'error','Esta tentativa já foi recebida com outros dados.'); end if;
      return jsonb_build_object('http_status',200,'received',true,'id',candidate.id);
    end if;
  end if;
  if (select count(*) from public.beta_submission_attempts where fingerprint=p_fingerprint and created_at > now()-interval '1 hour') >= 5 then
    return jsonb_build_object('http_status',429,'error','Limite de tentativas atingido. Aguarde antes de tentar novamente.');
  end if;
  insert into public.beta_submission_attempts(fingerprint) values(p_fingerprint);
  if exists(select 1 from public.beta_applications where lower(email)=email_value and status not in ('closed','converted')) then
    return jsonb_build_object('http_status',409,'error','Já existe uma candidatura ativa para este e-mail.');
  end if;
  if coalesce((p_payload->>'consentTerms')::boolean,false) is not true or nullif(trim(p_payload->>'name'),'') is null or nullif(trim(p_payload->>'restaurantName'),'') is null or position('@' in email_value)<2 then
    return jsonb_build_object('http_status',400,'error','Revise os dados e o aceite do regulamento.');
  end if;
  insert into public.beta_applications(name,restaurant_name,email,phone,establishment_type,source,consent_terms,consent_marketing,consent_version,city,neighborhood,equipment,campaign,consent_privacy,privacy_version,request_id,request_hash)
    values(p_payload->>'name',p_payload->>'restaurantName',email_value,nullif(p_payload->>'phone',''),nullif(p_payload->>'establishmentType',''),p_payload->>'source',true,coalesce((p_payload->>'consentMarketing')::boolean,false),p_payload->>'termsVersion',nullif(p_payload->>'city',''),nullif(p_payload->>'neighborhood',''),nullif(p_payload->>'equipment',''),coalesce(p_payload->'campaign','{}'::jsonb),(p_payload->>'consentPrivacy')::boolean,nullif(p_payload->>'privacyVersion',''),request_uuid,p_payload->>'requestHash') returning * into candidate;
  insert into public.beta_consent_events(application_id,consent_type,granted,document_version,source) values
    (candidate.id,'program_terms',true,candidate.consent_version,candidate.source),
    (candidate.id,'marketing',candidate.consent_marketing,candidate.consent_version,candidate.source);
  if candidate.consent_privacy is not null then
    insert into public.beta_consent_events(application_id,consent_type,granted,document_version,source) values(candidate.id,'privacy',candidate.consent_privacy,candidate.privacy_version,candidate.source);
  end if;
  insert into public.beta_application_events(application_id,event_type,to_status,metadata) values(candidate.id,'submitted','new',jsonb_build_object('source',candidate.source));
  return jsonb_build_object('http_status',201,'received',true,'id',candidate.id);
end $$;

create or replace function public.update_beta_application_atomic(p_id uuid,p_expected_updated_at timestamptz,p_status text,p_note text,p_assigned_to text,p_assignment_provided boolean,p_cohort text,p_actor_user_id uuid,p_actor_email text,p_store_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  candidate public.beta_applications;
  participant public.beta_participants;
  subscription public.subscriptions;
  allowed text[];
  timestamp_now timestamptz := clock_timestamp();
  previous_status text;
  activation timestamptz;
  ending timestamptz;
  has_participant boolean;
begin
  select * into candidate from public.beta_applications where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Candidatura não encontrada.'; end if;
  if p_actor_user_id is null or nullif(trim(p_actor_email),'') is null then raise exception 'Responsável administrativo ausente.'; end if;
  if p_expected_updated_at is distinct from candidate.updated_at then raise exception using errcode='40001',message='A candidatura mudou. Atualize a ficha antes de salvar.'; end if;
  previous_status := candidate.status;
  allowed := case candidate.status when 'new' then array['review','closed'] when 'review' then array['new','contact','closed'] when 'contact' then array['review','interview','closed'] when 'interview' then array['contact','approved','closed'] when 'approved' then array['interview','onboarding','closed'] when 'onboarding' then array['active','closed'] when 'active' then array['completed','closed'] when 'completed' then array['converted','closed'] else array[]::text[] end;
  if p_status <> candidate.status and not(p_status=any(allowed)) then raise exception using errcode='22023',message='Esta mudança de etapa não é permitida.'; end if;
  if (p_status<>candidate.status or p_store_id is not null) and nullif(trim(p_note),'') is null then raise exception using errcode='22023',message='Registre uma observação antes de continuar.'; end if;
  select * into participant from public.beta_participants where application_id=p_id for update;
  has_participant := found;
  if p_status='onboarding' and not has_participant then
    insert into public.beta_participants(application_id,cohort,status) values(p_id,coalesce(nullif(p_cohort,''),'founders-2026'),'onboarding') returning * into participant;
    has_participant := true;
    insert into public.beta_application_events(application_id,event_type,from_status,to_status,actor_email) values(p_id,'participant_created',candidate.status,p_status,p_actor_email);
  end if;
  if p_store_id is not null then
    if not has_participant or participant.status<>'onboarding' then raise exception using errcode='22023',message='Vincule a operação durante a preparação do beta.'; end if;
    if participant.store_id is not null and participant.store_id<>p_store_id then raise exception using errcode='22023',message='O participante já possui outra operação vinculada.'; end if;
    perform 1 from public.stores where id=p_store_id for update;
    select * into subscription from public.subscriptions where user_id=p_store_id for update;
    if not found then raise exception using errcode='22023',message='Prepare a assinatura da operação antes de vincular o beta.'; end if;
    update public.beta_participants set store_id=p_store_id,subscription_id=subscription.id,updated_at=timestamp_now where id=participant.id returning * into participant;
    insert into public.beta_application_events(application_id,event_type,actor_email,note,metadata) values(p_id,'store_linked',p_actor_email,p_note,jsonb_build_object('storeId',p_store_id));
  end if;
  if p_status in ('active','completed','converted') and not has_participant then raise exception using errcode='22023',message='Conclua a preparação do participante antes de avançar.'; end if;
  if p_status='active' then
    if participant.store_id is null or participant.subscription_id is null then raise exception using errcode='22023',message='Vincule a conta do restaurante antes de ativar o beta.'; end if;
    select * into subscription from public.subscriptions where id=participant.subscription_id and user_id=participant.store_id for update;
    if not found then raise exception using errcode='22023',message='A assinatura vinculada não foi encontrada.'; end if;
    if subscription.mercado_pago_subscription_id is not null or (subscription.status='active' and (select price from public.plans where id=subscription.plan_id)>0) then raise exception using errcode='22023',message='Esta operação possui uma assinatura comercial. Revise o vínculo antes de ativar o beta.'; end if;
    activation := coalesce(participant.activated_at,timestamp_now);
    ending := coalesce(participant.beta_ends_at,activation+interval '90 days');
    update public.subscriptions set status='trialing',current_period_end=ending,cancel_at_period_end=false,updated_at=timestamp_now where id=subscription.id;
    update public.beta_participants set status='active',activated_at=activation,beta_ends_at=ending,updated_at=timestamp_now where id=participant.id;
  elsif has_participant and p_status in ('completed','converted','closed') then
    if p_status in ('completed','converted') and participant.activated_at is null then raise exception using errcode='22023',message='O participante ainda não iniciou o beta.'; end if;
    update public.beta_participants set status=p_status,updated_at=timestamp_now where id=participant.id;
    if p_status='closed' and participant.subscription_id is not null then
      update public.subscriptions set status='canceled',current_period_end=timestamp_now,cancel_at_period_end=false,updated_at=timestamp_now where id=participant.subscription_id and status='trialing' and mercado_pago_subscription_id is null;
    end if;
  end if;
  if has_participant and nullif(p_cohort,'') is not null then update public.beta_participants set cohort=p_cohort,updated_at=timestamp_now where id=participant.id; end if;
  update public.beta_applications set status=p_status,notes=coalesce(nullif(p_note,''),notes),assigned_to=case when p_assignment_provided then nullif(p_assigned_to,'') else coalesce(assigned_to,p_actor_email) end,updated_at=timestamp_now where id=p_id returning * into candidate;
  if previous_status<>p_status or nullif(p_note,'') is not null then
    insert into public.beta_application_events(application_id,event_type,from_status,to_status,actor_email,note) values(p_id,case when previous_status<>p_status then 'status_changed' else 'note_added' end,previous_status,p_status,p_actor_email,p_note);
  end if;
  insert into public.admin_audit_events(actor_user_id,actor_email,action,category,target_type,target_id,reason,before_state,after_state)
    values(p_actor_user_id,p_actor_email,'ADMIN_BETA_APPLICATION_UPDATED','beta','beta_application',p_id::text,p_note,jsonb_build_object('status',previous_status),jsonb_build_object('status',p_status));
  return to_jsonb(candidate);
end $$;

revoke all on function public.submit_beta_application_atomic(jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_beta_application_atomic(jsonb,text) to service_role;
revoke all on function public.update_beta_application_atomic(uuid,timestamptz,text,text,text,boolean,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.update_beta_application_atomic(uuid,timestamptz,text,text,text,boolean,text,uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
