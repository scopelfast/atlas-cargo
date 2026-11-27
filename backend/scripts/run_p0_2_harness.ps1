# Harness P0.2 — SOMENTE atlas_pay_p0_scratch (nunca atlas_cargo_prd).
# Uso local PG18: powershell -File backend/scripts/run_p0_2_harness.ps1
# Uso Docker PG14:  ... -PgPort 55414 -PgPassword scratch_pg14_only -OutDirName _p0_2_results_pg14
param(
  [string]$PgHost = 'localhost',
  [int]$PgPort = 5432,
  [string]$PgUser = 'postgres',
  [string]$PgPassword = '',
  [string]$OutDirName = '_p0_2_results'
)
$ErrorActionPreference = 'Stop'
$Psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$Createdb = 'C:\Program Files\PostgreSQL\18\bin\createdb.exe'
$Dropdb = 'C:\Program Files\PostgreSQL\18\bin\dropdb.exe'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Setup = Join-Path $PSScriptRoot 'p0_2_scratch_setup.sql'
$P0 = Join-Path $PSScriptRoot 'financeiro_atlas_pay_p0_constraints_postgres.sql'
$OutDir = Join-Path $Root "backend\scripts\$OutDirName"
$Results = @()
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Senha: parâmetro (Docker) ou .env local — não echo
if ($PgPassword) { $env:PGPASSWORD = $PgPassword }
else { $env:PGPASSWORD = (Select-String -Path (Join-Path $Root 'backend\.env') -Pattern '^DB_PASSWORD=(.*)$').Matches[0].Groups[1].Value }
$env:PGCLIENTENCODING = 'UTF8'
$PgConn = @('-h', $PgHost, '-p', "$PgPort", '-U', $PgUser)

function Assert-ScratchDb([string]$Db) {
  if ($Db -ne 'atlas_pay_p0_scratch') { throw "RECUSA: destino inválido '$Db' (só atlas_pay_p0_scratch)." }
}

function Invoke-ScratchSql {
  param([string]$Sql, [string]$Label, [switch]$AllowFail)
  Assert-ScratchDb 'atlas_pay_p0_scratch'
  $tmp = Join-Path $OutDir ("_tmp_$Label.sql")
  Set-Content -Path $tmp -Value $Sql -Encoding UTF8
  $log = Join-Path $OutDir ("$Label.log")
  $args = $PgConn + @('-d','atlas_pay_p0_scratch','-v','ON_ERROR_STOP=1','-f',$tmp)
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $Psql @args *> $log
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if (-not $AllowFail -and $code -ne 0) { throw "Falha SQL $Label exit=$code (ver $log)" }
  return @{ Code = $code; Log = $log }
}

function Invoke-ScratchFile {
  param([string]$File, [string]$Label, [switch]$AllowFail)
  Assert-ScratchDb 'atlas_pay_p0_scratch'
  $log = Join-Path $OutDir ("$Label.log")
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $args = $PgConn + @('-d','atlas_pay_p0_scratch','-v','ON_ERROR_STOP=1','-f',$File)
  & $Psql @args *> $log
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if (-not $AllowFail -and $code -ne 0) { throw "Falha file $Label exit=$code (ver $log)" }
  return @{ Code = $code; Log = $log }
}

function Get-Scalar([string]$Sql) {
  Assert-ScratchDb 'atlas_pay_p0_scratch'
  $args = $PgConn + @('-d','atlas_pay_p0_scratch','-t','-A','-c',$Sql)
  $r = & $Psql @args
  return ($r | Out-String).Trim()
}

function Add-Result($n, $name, $status, $detail) {
  if ($script:Results | Where-Object { $_.N -eq $n }) { return }
  $script:Results += [pscustomobject]@{ N = $n; Name = $name; Status = $status; Detail = $detail }
  Write-Host ("[{0}] #{1} {2} — {3}" -f $status, $n, $name, $detail)
}

function Restore-P0 {
  Invoke-ScratchFile -File $P0 -Label ("restore_" + [guid]::NewGuid().ToString('N').Substring(0,8)) -AllowFail | Out-Null
}

function Reset-Scratch {
  Assert-ScratchDb 'atlas_pay_p0_scratch'
  # Limpa objetos P0 e recria FIN_* limpas
  $sql = @'
DROP TRIGGER IF EXISTS "trg_fin_evt_append_only" ON public."FIN_COBRANCA_EVENTO";
DROP TRIGGER IF EXISTS "trg_fin_cob_valor_imutavel" ON public."FIN_COBRANCA";
DROP FUNCTION IF EXISTS public."fn_fin_evt_append_only"();
DROP FUNCTION IF EXISTS public."fn_fin_cob_valor_imutavel"();
DROP INDEX IF EXISTS public."UK_FIN_COB_CICLO_ABS";
DROP INDEX IF EXISTS public."UK_FIN_COB_CICLO_ATIVA";
DROP INDEX IF EXISTS public."UK_FIN_COB_CONV_ABERTA";
DROP INDEX IF EXISTS public."UK_FIN_CONTRATO_TENANT_VERSAO";
DROP INDEX IF EXISTS public."UK_FIN_CONTRATO_VIGENTE";
DROP INDEX IF EXISTS public."IX_FIN_CONTRATO_TENANT";
DROP INDEX IF EXISTS public."IX_FIN_COMP_CONTRATO";
DROP INDEX IF EXISTS public."IX_FIN_COB_TENANT_STATUS";
DROP INDEX IF EXISTS public."IX_FIN_COB_CONV";
DROP INDEX IF EXISTS public."IX_FIN_COB_PAGADOR_MOT";
DROP INDEX IF EXISTS public."IX_FIN_COB_VIAGEM";
DROP INDEX IF EXISTS public."IX_FIN_EVT_COB";
DROP INDEX IF EXISTS public."ix_equiv_ciclo_abs";
ALTER TABLE public."FIN_COBRANCA_EVENTO" DROP CONSTRAINT IF EXISTS "FK_FIN_EVT_COB";
ALTER TABLE public."FIN_COBRANCA_EVENTO" DROP CONSTRAINT IF EXISTS "CK_FIN_EVT_TIPO";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_MOD";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_PAG";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_STATUS";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_MOEDA";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_VALOR";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_ORIGEM_CANC";
ALTER TABLE public."FIN_COBRANCA" DROP CONSTRAINT IF EXISTS "CK_FIN_COB_CONEXAO_REF";
ALTER TABLE public."FIN_CONTRATO_COMPONENTE" DROP CONSTRAINT IF EXISTS "FK_FIN_COMP_CONTRATO";
ALTER TABLE public."FIN_CONTRATO_COMPONENTE" DROP CONSTRAINT IF EXISTS "CK_FIN_COMP_GRUPO";
ALTER TABLE public."FIN_CONTRATO_COMPONENTE" DROP CONSTRAINT IF EXISTS "CK_FIN_COMP_TIPO";
ALTER TABLE public."FIN_CONTRATO_COMPONENTE" DROP CONSTRAINT IF EXISTS "CK_FIN_COMP_ATIVO";
ALTER TABLE public."FIN_CONTRATO_COMPONENTE" DROP CONSTRAINT IF EXISTS "CK_FIN_COMP_VALOR";
ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "FK_FIN_CONTRATO_TENANT";
ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "CK_FIN_CONTRATO_REGRA";
ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "CK_FIN_CONTRATO_POL";
ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "CK_FIN_CONTRATO_ACTIVE";
DROP TABLE IF EXISTS public."FIN_COBRANCA_EVENTO" CASCADE;
DROP TABLE IF EXISTS public."FIN_COBRANCA" CASCADE;
DROP TABLE IF EXISTS public."FIN_CONTRATO_COMPONENTE" CASCADE;
DROP TABLE IF EXISTS public."FIN_CONTRATO" CASCADE;
DROP DOMAIN IF EXISTS public.dom_nome_scratch CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_fin_manutencao') THEN
    DROP ROLE atlas_fin_manutencao;
  END IF;
END $$;
'@
  Invoke-ScratchSql -Sql $sql -Label 'reset_p0' | Out-Null
  Invoke-ScratchFile -File $Setup -Label 'setup_again' | Out-Null
}

Write-Host ("=== Destino confirmado: atlas_pay_p0_scratch @ {0}:{1} (NÃO atlas_cargo_prd) ===" -f $PgHost, $PgPort)

# Recria scratch do zero
& $Psql @PgConn -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='atlas_pay_p0_scratch' AND pid <> pg_backend_pid();" 2>$null | Out-Null
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $Dropdb @PgConn --if-exists atlas_pay_p0_scratch 2>$null | Out-Null
& $Createdb @PgConn atlas_pay_p0_scratch 2>$null | Out-Null
$ErrorActionPreference = $prevEap
$verify = (& $Psql @PgConn -d atlas_pay_p0_scratch -t -A -c "SELECT current_database();").Trim()
if ($verify -ne 'atlas_pay_p0_scratch') { throw "Banco errado: $verify" }
$pgVer = (& $Psql @PgConn -d atlas_pay_p0_scratch -t -A -c "SELECT current_setting('server_version');").Trim()
Write-Host "Conectado em database=[$verify] user=$PgUser server=$pgVer (scratch OK)"

Invoke-ScratchFile -File $Setup -Label '00_setup' | Out-Null

# ---------- Test 1 ----------
try {
  $r = Invoke-ScratchFile -File $P0 -Label '01_first'
  $ck = Get-Scalar 'SELECT COUNT(*) FROM pg_constraint WHERE conname LIKE ''CK_FIN_%'';'
  $role = Get-Scalar "SELECT COUNT(*) FROM pg_roles WHERE rolname='atlas_fin_manutencao'"
  if ($r.Code -eq 0 -and [int]$ck -ge 10 -and [int]$role -eq 1) { Add-Result 1 'Primeira execução' 'PASS' "constraints_ck=$ck role=1" }
  else { Add-Result 1 'Primeira execução' 'FAIL' "code=$($r.Code) ck=$ck role=$role" }
} catch { Add-Result 1 'Primeira execução' 'FAIL' $_.Exception.Message }

# ---------- Test 2 ----------
try {
  $r = Invoke-ScratchFile -File $P0 -Label '02_idem'
  $idx = Get-Scalar "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname='UK_FIN_COB_CICLO_ABS'"
  if ($r.Code -eq 0 -and [int]$idx -eq 1) { Add-Result 2 'Idempotência' 'PASS' '2a execução ok; ABS único' }
  else { Add-Result 2 'Idempotência' 'FAIL' "code=$($r.Code) abs=$idx" }
} catch { Add-Result 2 'Idempotência' 'FAIL' $_.Exception.Message }

# ---------- Test 3: índice equivalente outro nome ----------
try {
  Invoke-ScratchSql -Sql 'DROP INDEX IF EXISTS public."UK_FIN_COB_CICLO_ABS"; CREATE UNIQUE INDEX ix_equiv_ciclo_abs ON public."FIN_COBRANCA" ("IDCONVOCACAO","ID_CICLO_CONFIRMACAO") WHERE "MODALIDADE" = ''CONEXAO'';' -Label '03_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '03_equiv'
  $abs = Get-Scalar "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname='UK_FIN_COB_CICLO_ABS'"
  $eq = Get-Scalar "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname='ix_equiv_ciclo_abs'"
  # P0 deve NOTICE e NÃO criar ABS se equivalente existe
  if ($r.Code -eq 0 -and [int]$abs -eq 0 -and [int]$eq -eq 1) { Add-Result 3 'Índice equivalente outro nome' 'PASS' 'sem duplicar ABS' }
  else { Add-Result 3 'Índice equivalente outro nome' 'FAIL' "abs=$abs eq=$eq code=$($r.Code)" }
  # restaura ABS canônico
  Invoke-ScratchSql -Sql 'DROP INDEX IF EXISTS public.ix_equiv_ciclo_abs;' -Label '03_cleanup' -AllowFail | Out-Null
  Invoke-ScratchFile -File $P0 -Label '03_restore' | Out-Null
} catch { Add-Result 3 'Índice equivalente outro nome' 'FAIL' $_.Exception.Message }

# ---------- Test 4: mesmo nome def errada ----------
try {
  Invoke-ScratchSql -Sql 'DROP INDEX IF EXISTS public."UK_FIN_COB_CONV_ABERTA"; CREATE UNIQUE INDEX "UK_FIN_COB_CONV_ABERTA" ON public."FIN_COBRANCA" ("TENANT_ID");' -Label '04_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '04_badidx' -AllowFail
  if ($r.Code -ne 0) { Add-Result 4 'Índice mesmo nome errado' 'PASS' 'erro esperado' }
  else { Add-Result 4 'Índice mesmo nome errado' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql 'DROP INDEX IF EXISTS public."UK_FIN_COB_CONV_ABERTA";' -Label '04_cleanup' -AllowFail | Out-Null
  Invoke-ScratchFile -File $P0 -Label '04_restore' | Out-Null
} catch { Add-Result 4 'Índice mesmo nome errado' 'FAIL' $_.Exception.Message }

# ---------- Test 5: collation textual ----------
try {
  $coll = Get-Scalar @"
SELECT i.indcollation[0]::text
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname = 'UK_FIN_CONTRATO_TENANT_VERSAO'
"@
  # TENANT_ID é varchar → collation != tipicamente documentada; apenas garantir P0 aceita (já passou idem)
  if ($coll -ne '') { Add-Result 5 'Collation textual' 'PASS' "indcollation[0]=$coll (não forçado a 0)" }
  else { Add-Result 5 'Collation textual' 'FAIL' 'não leu indcollation' }
} catch { Add-Result 5 'Collation textual' 'FAIL' $_.Exception.Message }

# ---------- Test 6: DESC NULLS FIRST ----------
try {
  $opt = Get-Scalar @"
SELECT i.indoption[2]::text
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE c.relname='IX_FIN_COB_TENANT_STATUS'
"@
  # 3ª coluna DH_CRIACAO DESC NULLS FIRST → 3
  if ($opt -eq '3') { Add-Result 6 'DESC NULLS FIRST' 'PASS' "indoption[2]=3" }
  else { Add-Result 6 'DESC NULLS FIRST' 'FAIL' "indoption[2]=$opt" }
} catch { Add-Result 6 'DESC NULLS FIRST' 'FAIL' $_.Exception.Message }

# ---------- Test 7: opclass ----------
try {
  $opc = Get-Scalar @"
SELECT COUNT(*) FROM pg_index i
 JOIN pg_class c ON c.oid=i.indexrelid
 WHERE c.relname='IX_FIN_CONTRATO_TENANT' AND i.indclass[0] IS NOT NULL
"@
  if ([int]$opc -eq 1) { Add-Result 7 'Opclass padrão' 'PASS' 'indclass presente' }
  else { Add-Result 7 'Opclass padrão' 'FAIL' "opc=$opc" }
} catch { Add-Result 7 'Opclass padrão' 'FAIL' $_.Exception.Message }

# ---------- Test 8: domínio varchar ----------
try {
  Reset-Scratch
  Invoke-ScratchSql -Sql @'
CREATE DOMAIN public.dom_nome_scratch AS varchar(64);
ALTER TABLE public."FIN_CONTRATO" ALTER COLUMN "TENANT_ID" TYPE public.dom_nome_scratch USING "TENANT_ID"::public.dom_nome_scratch;
ALTER TABLE public."FIN_COBRANCA" ALTER COLUMN "TENANT_ID" TYPE public.dom_nome_scratch USING "TENANT_ID"::public.dom_nome_scratch;
ALTER TABLE public."FIN_COBRANCA" ALTER COLUMN "BENEFICIARIO_TENANT_ID" TYPE public.dom_nome_scratch USING "BENEFICIARIO_TENANT_ID"::public.dom_nome_scratch;
'@ -Label '08_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '08_domain'
  if ($r.Code -eq 0) { Add-Result 8 'Domínio sobre varchar' 'PASS' 'P0 ok com domínio' }
  else { Add-Result 8 'Domínio sobre varchar' 'FAIL' "code=$($r.Code)" }
  Reset-Scratch
  Invoke-ScratchFile -File $P0 -Label '08_restore' | Out-Null
} catch {
  Add-Result 8 'Domínio sobre varchar' 'FAIL' $_.Exception.Message
  try { Reset-Scratch; Invoke-ScratchFile -File $P0 -Label '08_force_restore' | Out-Null } catch {}
}

# ---------- Test 9: FK anônima equivalente ----------
try {
  Reset-Scratch
  # setup já cria FK anônima em componente/evento via REFERENCES inline
  $r = Invoke-ScratchFile -File $P0 -Label '09_anon_fk'
  $named = Get-Scalar "SELECT COUNT(*) FROM pg_constraint WHERE conname='FK_FIN_COMP_CONTRATO'"
  if ($r.Code -eq 0 -and [int]$named -eq 1) { Add-Result 9 'FK anônima equivalente' 'PASS' 'renomeada/aceita FK_FIN_COMP_CONTRATO' }
  else { Add-Result 9 'FK anônima equivalente' 'FAIL' "code=$($r.Code) named=$named" }
} catch { Add-Result 9 'FK anônima equivalente' 'FAIL' $_.Exception.Message }

# ---------- Test 10: FK NOT VALID ----------
try {
  # Remove named FK and add NOT VALID with same structure under temp name... 
  # PG: ADD CONSTRAINT NOT VALID
  Invoke-ScratchSql -Sql @'
ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "FK_FIN_CONTRATO_TENANT";
ALTER TABLE public."FIN_CONTRATO" ADD CONSTRAINT "FK_FIN_CONTRATO_TENANT"
  FOREIGN KEY ("TENANT_ID") REFERENCES public."SAAS_CLIENTE_CONTRATANTE"("TENANT_ID") NOT VALID;
'@ -Label '10_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '10_notvalid' -AllowFail
  if ($r.Code -ne 0) { Add-Result 10 'FK NOT VALID' 'PASS' 'erro esperado' }
  else { Add-Result 10 'FK NOT VALID' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql 'ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "FK_FIN_CONTRATO_TENANT"; ALTER TABLE public."FIN_CONTRATO" ADD CONSTRAINT "FK_FIN_CONTRATO_TENANT" FOREIGN KEY ("TENANT_ID") REFERENCES public."SAAS_CLIENTE_CONTRATANTE"("TENANT_ID");' -Label '10_fix' | Out-Null
  Invoke-ScratchFile -File $P0 -Label '10_restore' | Out-Null
} catch { Add-Result 10 'FK NOT VALID' 'FAIL' $_.Exception.Message }

# ---------- Test 11: FK estrutura errada mesmo nome ----------
try {
  Invoke-ScratchSql -Sql @'
ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "FK_FIN_CONTRATO_TENANT";
-- cria FK com ON DELETE CASCADE (esperado NO ACTION) para divergir
ALTER TABLE public."FIN_CONTRATO" ADD CONSTRAINT "FK_FIN_CONTRATO_TENANT"
  FOREIGN KEY ("TENANT_ID") REFERENCES public."SAAS_CLIENTE_CONTRATANTE"("TENANT_ID") ON DELETE CASCADE;
'@ -Label '11_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '11_badfk' -AllowFail
  if ($r.Code -ne 0) { Add-Result 11 'FK estrutura incorreta' 'PASS' 'erro esperado' }
  else { Add-Result 11 'FK estrutura incorreta' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql 'ALTER TABLE public."FIN_CONTRATO" DROP CONSTRAINT IF EXISTS "FK_FIN_CONTRATO_TENANT";' -Label '11_cleanup' -AllowFail | Out-Null
  Invoke-ScratchFile -File $P0 -Label '11_restore' | Out-Null
} catch { Add-Result 11 'FK estrutura incorreta' 'FAIL' $_.Exception.Message }

# ---------- Test 12: função idêntica ----------
try {
  $r = Invoke-ScratchFile -File $P0 -Label '12_fn_ok'
  if ($r.Code -eq 0) { Add-Result 12 'Função idêntica' 'PASS' 'reexecução aceita função' }
  else { Add-Result 12 'Função idêntica' 'FAIL' "code=$($r.Code)" }
} catch { Add-Result 12 'Função idêntica' 'FAIL' $_.Exception.Message }

# ---------- Test 13: corpo diferente ----------
try {
  Invoke-ScratchSql -Sql @'
CREATE OR REPLACE FUNCTION public."fn_fin_cob_valor_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END; $$;
'@ -Label '13_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '13_badbody' -AllowFail
  if ($r.Code -ne 0) { Add-Result 13 'Função corpo diferente' 'PASS' 'erro esperado' }
  else { Add-Result 13 'Função corpo diferente' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql @'
DROP TRIGGER IF EXISTS "trg_fin_cob_valor_imutavel" ON public."FIN_COBRANCA";
DROP FUNCTION IF EXISTS public."fn_fin_cob_valor_imutavel"();
'@ -Label '13_cleanup' -AllowFail | Out-Null
  Invoke-ScratchFile -File $P0 -Label '13_restore' | Out-Null
} catch { Add-Result 13 'Função corpo diferente' 'FAIL' $_.Exception.Message }

# ---------- Test 14: SECURITY DEFINER ----------
try {
  Invoke-ScratchSql -Sql @'
DROP TRIGGER IF EXISTS "trg_fin_evt_append_only" ON public."FIN_COBRANCA_EVENTO";
DROP FUNCTION IF EXISTS public."fn_fin_evt_append_only"();
CREATE FUNCTION public."fn_fin_evt_append_only"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN NULL; END; $$;
'@ -Label '14_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '14_secdef' -AllowFail
  if ($r.Code -ne 0) { Add-Result 14 'Função SECURITY DEFINER' 'PASS' 'erro esperado' }
  else { Add-Result 14 'Função SECURITY DEFINER' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql @'
DROP TRIGGER IF EXISTS "trg_fin_evt_append_only" ON public."FIN_COBRANCA_EVENTO";
DROP FUNCTION IF EXISTS public."fn_fin_evt_append_only"();
'@ -Label '14_cleanup' -AllowFail | Out-Null
  Invoke-ScratchFile -File $P0 -Label '14_restore' | Out-Null
} catch { Add-Result 14 'Função SECURITY DEFINER' 'FAIL' $_.Exception.Message }

# ---------- Test 15: trigger habilitado ----------
try {
  $en = Get-Scalar "SELECT tgenabled FROM pg_trigger WHERE tgname='trg_fin_cob_valor_imutavel' AND NOT tgisinternal"
  $r = Invoke-ScratchFile -File $P0 -Label '15_tg'
  if ($r.Code -eq 0 -and $en -eq 'O') { Add-Result 15 'Trigger habilitado' 'PASS' "tgenabled=$en" }
  else { Add-Result 15 'Trigger habilitado' 'FAIL' "en=$en code=$($r.Code)" }
} catch { Add-Result 15 'Trigger habilitado' 'FAIL' $_.Exception.Message }

# ---------- Test 16: trigger desabilitado ----------
try {
  Invoke-ScratchSql -Sql 'ALTER TABLE public."FIN_COBRANCA" DISABLE TRIGGER "trg_fin_cob_valor_imutavel";' -Label '16_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '16_disabled' -AllowFail
  if ($r.Code -ne 0) { Add-Result 16 'Trigger desabilitado' 'PASS' 'erro esperado' }
  else { Add-Result 16 'Trigger desabilitado' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql 'ALTER TABLE public."FIN_COBRANCA" ENABLE TRIGGER "trg_fin_cob_valor_imutavel";' -Label '16_cleanup' | Out-Null
  Invoke-ScratchFile -File $P0 -Label '16_restore' | Out-Null
} catch { Add-Result 16 'Trigger desabilitado' 'FAIL' $_.Exception.Message }

# ---------- Test 17: trigger divergente ----------
try {
  Invoke-ScratchSql -Sql @'
DROP TRIGGER IF EXISTS "trg_fin_cob_valor_imutavel" ON public."FIN_COBRANCA";
CREATE TRIGGER "trg_fin_cob_valor_imutavel"
  AFTER UPDATE ON public."FIN_COBRANCA"
  FOR EACH ROW EXECUTE PROCEDURE public."fn_fin_cob_valor_imutavel"();
'@ -Label '17_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '17_div' -AllowFail
  if ($r.Code -ne 0) { Add-Result 17 'Trigger divergente' 'PASS' 'erro esperado' }
  else { Add-Result 17 'Trigger divergente' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql 'DROP TRIGGER IF EXISTS "trg_fin_cob_valor_imutavel" ON public."FIN_COBRANCA";' -Label '17_cleanup' | Out-Null
  Invoke-ScratchFile -File $P0 -Label '17_restore' | Out-Null
} catch { Add-Result 17 'Trigger divergente' 'FAIL' $_.Exception.Message }

# ---------- Test 18: role ausente ----------
try {
  Invoke-ScratchSql -Sql @'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_fin_manutencao') THEN
    DROP ROLE atlas_fin_manutencao;
  END IF;
END $$;
'@ -Label '18_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '18_role'
  $role = Get-Scalar "SELECT COUNT(*) FROM pg_roles WHERE rolname='atlas_fin_manutencao'"
  if ($r.Code -eq 0 -and [int]$role -eq 1) { Add-Result 18 'Role ausente' 'PASS' 'role recriada' }
  else { Add-Result 18 'Role ausente' 'FAIL' "code=$($r.Code) role=$role" }
} catch { Add-Result 18 'Role ausente' 'FAIL' $_.Exception.Message }

# ---------- Test 19: role LOGIN ----------
try {
  Invoke-ScratchSql -Sql @'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_fin_manutencao') THEN
    DROP ROLE atlas_fin_manutencao;
  END IF;
  CREATE ROLE atlas_fin_manutencao LOGIN PASSWORD 'x';
END $$;
'@ -Label '19_prep' | Out-Null
  $r = Invoke-ScratchFile -File $P0 -Label '19_login' -AllowFail
  if ($r.Code -ne 0) { Add-Result 19 'Role com LOGIN' 'PASS' 'erro esperado' }
  else { Add-Result 19 'Role com LOGIN' 'FAIL' 'deveria falhar' }
  Invoke-ScratchSql -Sql @'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atlas_fin_manutencao') THEN
    DROP ROLE atlas_fin_manutencao;
  END IF;
END $$;
'@ -Label '19_cleanup' | Out-Null
  Invoke-ScratchFile -File $P0 -Label '19_restore' | Out-Null
} catch { Add-Result 19 'Role com LOGIN' 'FAIL' $_.Exception.Message }

# ---------- Test 20: rollback com cópia descartável + erro antes do COMMIT ----------
try {
  Reset-Scratch
  $beforeRole = Get-Scalar "SELECT COUNT(*) FROM pg_roles WHERE rolname='atlas_fin_manutencao'"
  $beforeCk = Get-Scalar "SELECT COUNT(*) FROM pg_constraint WHERE conname LIKE 'CK_FIN_%'"
  $canon = Get-Content -Path $P0 -Raw -Encoding UTF8
  if ($canon -notmatch '(?m)^COMMIT;\s*$') { throw 'COMMIT final não encontrado no canônico' }
  $failCopy = $canon -replace '(?m)^COMMIT;\s*$', "DO `$`$ BEGIN RAISE EXCEPTION 'P0 harness intentional failure before COMMIT'; END `$`$;`r`nCOMMIT;`r`n"
  $failPath = Join-Path $OutDir 'p0_intentional_fail.sql'
  Set-Content -Path $failPath -Value $failCopy -Encoding UTF8
  $r = Invoke-ScratchFile -File $failPath -Label '20_fail' -AllowFail
  $afterRole = Get-Scalar "SELECT COUNT(*) FROM pg_roles WHERE rolname='atlas_fin_manutencao'"
  $afterCk = Get-Scalar "SELECT COUNT(*) FROM pg_constraint WHERE conname LIKE 'CK_FIN_%'"
  $afterFn = Get-Scalar "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'fn_fin_%'"
  if ($r.Code -ne 0 -and $beforeRole -eq $afterRole -and $beforeCk -eq $afterCk -and [int]$afterFn -eq 0) {
    Add-Result 20 'Rollback após falha' 'PASS' "role $beforeRole->$afterRole ck $beforeCk->$afterCk fn=$afterFn"
  } else {
    Add-Result 20 'Rollback após falha' 'FAIL' "code=$($r.Code) role $beforeRole->$afterRole ck $beforeCk->$afterCk fn=$afterFn"
  }
  # restaura estado bom
  Invoke-ScratchFile -File $P0 -Label '20_restore' | Out-Null
} catch { Add-Result 20 'Rollback após falha' 'FAIL' $_.Exception.Message }

# ---------- D13 ----------
$d13 = Invoke-ScratchSql -Sql @'
SELECT current_database() AS db, version() AS pg_version;
SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolcreaterole, rolcreatedb
  FROM pg_roles
 WHERE rolname IN ('app_user','atlas_pay_scratch_app','atlas_fin_manutencao','postgres')
 ORDER BY rolname;
SELECT 'app_user' AS subject,
       pg_has_role('app_user', 'atlas_fin_manutencao', 'USAGE') AS usage_manut,
       pg_has_role('app_user', 'atlas_fin_manutencao', 'MEMBER') AS member_manut,
       (SELECT rolsuper FROM pg_roles WHERE rolname='app_user') AS is_super;
SELECT 'atlas_pay_scratch_app' AS subject,
       pg_has_role('atlas_pay_scratch_app', 'atlas_fin_manutencao', 'USAGE') AS usage_manut,
       pg_has_role('atlas_pay_scratch_app', 'atlas_fin_manutencao', 'MEMBER') AS member_manut;
-- membership direta/indireta via pg_auth_members
WITH RECURSIVE m AS (
  SELECT roleid, member, 1 AS depth
    FROM pg_auth_members
   WHERE member = (SELECT oid FROM pg_roles WHERE rolname='app_user')
  UNION ALL
  SELECT a.roleid, a.member, m.depth+1
    FROM pg_auth_members a
    JOIN m ON a.member = m.roleid
   WHERE m.depth < 20
)
SELECT COUNT(*) AS app_user_paths_to_manutencao
  FROM m
  JOIN pg_roles r ON r.oid = m.roleid
 WHERE r.rolname = 'atlas_fin_manutencao';
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
       (pg_get_userbyid(c.relowner) = 'app_user') AS owned_by_app_user
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname LIKE 'FIN_%' AND c.relkind='r'
 ORDER BY c.relname;
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
       (pg_get_userbyid(p.proowner) = 'app_user') AS owned_by_app_user
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'fn_fin_%'
 ORDER BY p.proname;
SELECT rolname, rolcanlogin, rolsuper, rolinherit
  FROM pg_roles WHERE rolname='atlas_fin_manutencao';
'@ -Label 'd13'

$d13Text = Get-Content (Join-Path $OutDir 'd13.log') -Raw
$d13Path = Join-Path $OutDir 'd13_summary.txt'
Set-Content $d13Path $d13Text

# Classificação D13 (impeditivo se app_user SUPERUSER / owner / membership)
$appSuper = Get-Scalar "SELECT rolsuper::text FROM pg_roles WHERE rolname='app_user'"
$appOwnerTbl = Get-Scalar "SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'FIN_%' AND r.rolname='app_user'"
$appOwnerFn = Get-Scalar "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.proname LIKE 'fn_fin_%' AND r.rolname='app_user'"
$appMember = Get-Scalar "SELECT pg_has_role('app_user','atlas_fin_manutencao','MEMBER')::text"
$manutLogin = Get-Scalar "SELECT rolcanlogin::text FROM pg_roles WHERE rolname='atlas_fin_manutencao'"
$d13Ok = ($appSuper -eq 'f' -or $appSuper -eq 'false') -and [int]$appOwnerTbl -eq 0 -and [int]$appOwnerFn -eq 0 -and ($appMember -eq 'f' -or $appMember -eq 'false') -and ($manutLogin -eq 'f' -or $manutLogin -eq 'false')
if ($d13Ok) {
  Add-Result 97 'D13 segurança' 'PASS' "app_user super=$appSuper owner_tbl=$appOwnerTbl owner_fn=$appOwnerFn member=$appMember manut_login=$manutLogin"
} else {
  # SUPERUSER ou ownership = IMPEDITIVO GO
  $sev = if (($appSuper -eq 't' -or $appSuper -eq 'true') -or [int]$appOwnerTbl -gt 0 -or [int]$appOwnerFn -gt 0 -or ($appMember -eq 't' -or $appMember -eq 'true')) { 'IMPEDITIVO' } else { 'FAIL' }
  Add-Result 97 'D13 segurança' 'FAIL' "$sev super=$appSuper owner_tbl=$appOwnerTbl owner_fn=$appOwnerFn member=$appMember manut_login=$manutLogin"
}

# ---------- Compatibilidade (rótulo conforme servidor real desta execução) ----------
$verNum = [int]((& $Psql @PgConn -d atlas_pay_p0_scratch -t -A -c "SELECT current_setting('server_version_num');").Trim())
if ($verNum -ge 140000 -and $verNum -lt 150000) {
  Add-Result 99 'Compat PG14' 'PASS' "Executado em PostgreSQL $pgVer"
  Add-Result 98 'Compat PG15+' 'BLOCKED' 'Esta execução é PG14; PG15+ validado em bateria separada'
} elseif ($verNum -ge 150000) {
  Add-Result 98 'Compat PG15+' 'PASS' "Executado em PostgreSQL $pgVer"
  Add-Result 99 'Compat PG14' 'BLOCKED' 'Esta execução não é PG14; ver bateria Docker/separada'
} else {
  Add-Result 99 'Compat PG14' 'FAIL' "Versão inesperada $pgVer ($verNum)"
  Add-Result 98 'Compat PG15+' 'FAIL' "Versão inesperada $pgVer ($verNum)"
}

# Export CSV
$csv = Join-Path $OutDir 'results.csv'
$Results | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
Write-Host "`n=== RESUMO ==="
$Results | Format-Table -AutoSize
$pass = ($Results | Where-Object { $_.N -le 20 -and $_.Status -eq 'PASS' }).Count
$fail = ($Results | Where-Object { $_.N -le 20 -and $_.Status -eq 'FAIL' }).Count
Write-Host "PASS=$pass FAIL=$fail (de 20)"
Write-Output "PASS=$pass;FAIL=$fail;OUT=$OutDir"
