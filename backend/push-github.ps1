# Script auxiliar - redireciona para o script principal na raiz
# Este arquivo permite executar o script de qualquer lugar

$scriptPath = Join-Path $PSScriptRoot "..\push-github.ps1"
$scriptPath = Resolve-Path $scriptPath -ErrorAction SilentlyContinue

if ($scriptPath -and (Test-Path $scriptPath)) {
    # Se foi passado um argumento, usa como mensagem
    if ($args.Count -gt 0) {
        & $scriptPath -mensagem $args[0]
    } else {
        & $scriptPath
    }
} else {
    Write-Host "Erro: Script principal nao encontrado!" -ForegroundColor Red
    Write-Host "Certifique-se de que o arquivo push-github.ps1 esta na raiz do projeto." -ForegroundColor Yellow
    exit 1
}

