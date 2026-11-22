# Wdrozenie aplikacji KOWR na Google Cloud Run.
# Uzycie (PowerShell, z katalogu repo):
#   .\deploy.ps1 -Project <id-projektu-gcp>
#   .\deploy.ps1 -Project <id> -Region europe-central2 -Service kowr
# Wymaga: gcloud CLI (winget install Google.CloudSDK), konta GCP z wlaczonym billingiem.
# Obraz buduje Cloud Build na podstawie Dockerfile, lokalny Docker nie jest potrzebny.
param(
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Region = "europe-central2",
    [string]$Service = "kowr"
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "Brak gcloud CLI. Zainstaluj: winget install Google.CloudSDK, potem: gcloud init"
    exit 1
}

$account = gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (-not $account) {
    Write-Host "Brak zalogowanego konta. Uruchamiam: gcloud auth login"
    gcloud auth login
    if (-not $?) { exit 1 }
}

Write-Host "[1/3] Projekt $Project, region $Region"
gcloud config set project $Project
if (-not $?) { exit 1 }

Write-Host "[2/3] Wlaczam wymagane API (pierwszy raz trwa ok. minuty)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
if (-not $?) { exit 1 }

Write-Host "[3/3] Buduje obraz i wdrazam usluge $Service (5-10 min)"
# --max-instances 1: zapisane pola sa w SQLite w pamieci instancji, worker raportow dziala w tym samym procesie
# --no-cpu-throttling: worker raportow pol (app/fields.py) liczy w tle, takze miedzy zapytaniami
# --min-instances 1: brak zimnego startu przy pokazie
# --timeout 300: pobieranie NMT z GUGiK potrafi trwac do 180 s
gcloud run deploy $Service `
    --source . `
    --region $Region `
    --allow-unauthenticated `
    --port 8080 `
    --cpu 2 `
    --memory 2Gi `
    --timeout 300 `
    --concurrency 40 `
    --min-instances 1 `
    --max-instances 1 `
    --no-cpu-throttling `
    --cpu-boost `
    --execution-environment gen2 `
    --quiet
if (-not $?) { exit 1 }

$url = gcloud run services describe $Service --region $Region --format="value(status.url)"
Write-Host ""
Write-Host "Gotowe. Aplikacja: $url"
