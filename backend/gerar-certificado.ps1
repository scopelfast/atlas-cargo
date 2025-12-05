# =============================================
# Script PowerShell para Gerar Certificado SSL
# Uso: .\gerar-certificado.ps1
# =============================================

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Gerador de Certificado SSL Auto-Assinado" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se OpenSSL está instalado
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue

if (-not $opensslPath) {
    Write-Host "❌ OpenSSL não encontrado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Instale o OpenSSL:" -ForegroundColor Yellow
    Write-Host "  1. Baixe: https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Yellow
    Write-Host "  2. Instale o 'Win64 OpenSSL v3.x.x Light'" -ForegroundColor Yellow
    Write-Host "  3. Adicione ao PATH do Windows" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "✅ OpenSSL encontrado!" -ForegroundColor Green
Write-Host ""

# Criar pasta ssl se não existir
$sslFolder = Join-Path $PSScriptRoot "..\ssl"
if (-not (Test-Path $sslFolder)) {
    New-Item -ItemType Directory -Path $sslFolder | Out-Null
    Write-Host "✅ Pasta 'ssl' criada" -ForegroundColor Green
}

# Perguntar IP do servidor
Write-Host "Digite o IP do servidor (padrão: 192.168.1.173):" -ForegroundColor Yellow
$ip = Read-Host
if ([string]::IsNullOrWhiteSpace($ip)) {
    $ip = "192.168.1.173"
}

Write-Host ""
Write-Host "🔐 Gerando certificado SSL..." -ForegroundColor Cyan
Write-Host ""

# Criar arquivo de configuração OpenSSL
$configContent = @"
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C=BR
ST=Parana
L=Curitiba
O=SysScopel
OU=Development
emailAddress=admin@sysscopel.com
CN=$ip

[v3_req]
subjectAltName = @alt_names

[alt_names]
IP.1 = $ip
IP.2 = 127.0.0.1
DNS.1 = localhost
"@

$configPath = Join-Path $sslFolder "openssl.cnf"
$configContent | Out-File -FilePath $configPath -Encoding ASCII

# Gerar certificado
$keyPath = Join-Path $sslFolder "key.pem"
$certPath = Join-Path $sslFolder "cert.pem"

try {
    & openssl req -x509 -newkey rsa:4096 -keyout $keyPath -out $certPath -days 365 -nodes -config $configPath 2>&1 | Out-Null
    
    if (Test-Path $keyPath -and Test-Path $certPath) {
        Write-Host "✅ Certificado SSL gerado com sucesso!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📁 Arquivos criados:" -ForegroundColor Cyan
        Write-Host "   - $keyPath" -ForegroundColor White
        Write-Host "   - $certPath" -ForegroundColor White
        Write-Host ""
        Write-Host "🚀 Para iniciar o servidor HTTPS:" -ForegroundColor Cyan
        Write-Host "   cd backend" -ForegroundColor White
        Write-Host "   node server-https.js" -ForegroundColor White
        Write-Host ""
        Write-Host "🔒 Acesse no navegador:" -ForegroundColor Cyan
        Write-Host "   https://$ip`:3443/motorista/pages/dashboard.html" -ForegroundColor White
        Write-Host ""
        Write-Host "⚠️  IMPORTANTE: O navegador vai mostrar aviso de segurança." -ForegroundColor Yellow
        Write-Host "   Clique em 'Avançado' → 'Continuar mesmo assim'" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "❌ Erro ao gerar certificado!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Erro: $_" -ForegroundColor Red
    exit 1
} finally {
    # Remover arquivo de configuração temporário
    Remove-Item $configPath -ErrorAction SilentlyContinue
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

