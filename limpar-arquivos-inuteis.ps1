# ========================================
# Script: Limpar Arquivos Não Usados
# ========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LIMPEZA DE ARQUIVOS NÃO USADOS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se está na raiz do projeto
if (-not (Test-Path "backend")) {
    Write-Host "[ERRO] Execute este script na raiz do projeto SysScopel!" -ForegroundColor Red
    exit 1
}

$itensParaDeletar = @()

Write-Host "Analisando arquivos não usados..." -ForegroundColor Yellow
Write-Host ""

# 1. backend/controllers/script.js (VAZIO!)
if (Test-Path "backend\controllers\script.js") {
    $itensParaDeletar += @{
        Path = "backend\controllers\script.js"
        Descricao = "Controller VAZIO - completamente inútil"
        Tipo = "CRÍTICO"
    }
}

# 2. backend/public/img/js/redirect.js (local errado!)
if (Test-Path "backend\public\img\js\redirect.js") {
    $itensParaDeletar += @{
        Path = "backend\public\img\js\redirect.js"
        Descricao = "JS na pasta de IMAGENS (duplicado)"
        Tipo = "CRÍTICO"
    }
}

# 3. backend/img/logo.png (duplicado fora do public)
if (Test-Path "backend\img\logo.png") {
    $itensParaDeletar += @{
        Path = "backend\img\logo.png"
        Descricao = "Imagem duplicada (já existe em public/img)"
        Tipo = "MÉDIO"
    }
}

# 4. Pasta img vazia
if (Test-Path "backend\img") {
    $itensParaDeletar += @{
        Path = "backend\img"
        Descricao = "Pasta img vazia após deletar logo.png"
        Tipo = "MÉDIO"
    }
}

# 5-9. Logos não usados (APENAS logo7.png está em uso!)
$logosNaoUsados = @("logo1.png", "logo2.png", "logo3.png", "logo4.png", "logo5.png", "logo6.png", "logo8.png")
foreach ($logo in $logosNaoUsados) {
    if (Test-Path "backend\public\img\$logo") {
        $itensParaDeletar += @{
            Path = "backend\public\img\$logo"
            Descricao = "Logo não usado (apenas logo7.png está em uso)"
            Tipo = "MÉDIO"
        }
    }
}

# Mostrar resumo
Write-Host "Arquivos encontrados para deletar:" -ForegroundColor Yellow
Write-Host ""

foreach ($item in $itensParaDeletar) {
    $cor = if ($item.Tipo -eq "CRÍTICO") { "Red" } else { "Yellow" }
    Write-Host "  [$($item.Tipo)]" -ForegroundColor $cor -NoNewline
    Write-Host " $($item.Path)" -ForegroundColor White
    Write-Host "    $($item.Descricao)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Total: $($itensParaDeletar.Count) arquivo(s)" -ForegroundColor Green
Write-Host ""

# Confirmar
$resposta = Read-Host "Deseja prosseguir com a limpeza? (S/N)"

if ($resposta -ne "S" -and $resposta -ne "s") {
    Write-Host ""
    Write-Host "[CANCELADO] Nenhuma alteração foi feita." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Iniciando limpeza..." -ForegroundColor Green
Write-Host ""

$sucessos = 0
$erros = 0

foreach ($item in $itensParaDeletar) {
    Write-Host "Deletando: $($item.Path)..." -NoNewline
    
    try {
        if (Test-Path $item.Path) {
            Remove-Item -Path $item.Path -Recurse -Force -ErrorAction Stop
            Write-Host " OK" -ForegroundColor Green
            $sucessos++
        } else {
            Write-Host " IGNORADO (não existe)" -ForegroundColor Gray
        }
    } catch {
        Write-Host " ERRO" -ForegroundColor Red
        Write-Host "  Detalhes: $($_.Exception.Message)" -ForegroundColor Red
        $erros++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LIMPEZA CONCLUÍDA!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Sucessos: $sucessos" -ForegroundColor Green
Write-Host "Erros: $erros" -ForegroundColor $(if ($erros -gt 0) { "Red" } else { "Green" })
Write-Host ""

# Perguntar sobre commit
$commit = Read-Host "Deseja fazer commit das alterações? (S/N)"

if ($commit -eq "S" -or $commit -eq "s") {
    Write-Host ""
    Write-Host "Fazendo commit..." -ForegroundColor Yellow
    
    git add .
    git commit -m "Remove arquivos não usados e mal localizados"
    
    $push = Read-Host "Deseja fazer push para o repositório? (S/N)"
    
    if ($push -eq "S" -or $push -eq "s") {
        Write-Host "Fazendo push..." -ForegroundColor Yellow
        git push origin main
        Write-Host ""
        Write-Host "[OK] Push concluído!" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Pronto! Arquivos inúteis removidos. 🎉" -ForegroundColor Green
Write-Host ""

