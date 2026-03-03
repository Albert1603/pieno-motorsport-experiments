@findstr /v "^@.*" "%~f0" | powershell -NoProfile -ExecutionPolicy Bypass - & goto :eof

# --- LMU One-Click Setup Loader ---
# 1. Copia il link del setup da Discord (Tasto destro -> Copia Link).
# 2. Lancia questo script.
# 3. Il setup finisce nella cartella della pista corretta automaticamente.

Add-Type -AssemblyName System.Windows.Forms

function Get-LMUPath {
    $steamPath = Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name "SteamPath" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SteamPath
    if (!$steamPath) { return $null }
    $vdfPath = "$steamPath\steamapps\libraryfolders.vdf"
    if (Test-Path $vdfPath) {
        $vdfContent = Get-Content $vdfPath -Raw
        $matches = [regex]::Matches($vdfContent, '"path"\s+"(.+?)"')
        foreach ($match in $matches) {
            $libPath = $match.Groups[1].Value.Replace("", "")
            $lmuPath = "$libPath\steamapps\common\Le Mans Ultimate"
            if (Test-Path "$lmuPath\Le Mans Ultimate.exe") { return $lmuPath }
        }
    }
    return $null
}

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "      LMU SETUP LOADER - AUTOMATIC" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

$lmuPath = Get-LMUPath
if (!$lmuPath) {
    Write-Host "ERRORE: Non trovo Le Mans Ultimate automaticamente." -ForegroundColor Red
    $lmuPath = Read-Host "Incolla il percorso della cartella del gioco"
}

# Prendi URL dalla Clipboard
$url = [System.Windows.Forms.Clipboard]::GetText()

if ($url -notmatch "^http") {
    Write-Host "`n[ERRORE] Non hai copiato un link valido!" -ForegroundColor Red
    Write-Host "Fai cosi:" -ForegroundColor White
    Write-Host "1. Vai su Discord" -ForegroundColor White
    Write-Host "2. Tasto destro sul file del setup -> 'Copia Link'" -ForegroundColor White
    Write-Host "3. Rilancia questo script" -ForegroundColor White
    Pause
    exit
}

Write-Host "`n>>> Scaricamento setup in corso..." -ForegroundColor Yellow
$tempFile = "$env:TEMP	emp_lmu_setup.svm"
try {
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($url, $tempFile)
} catch {
    Write-Host "Errore nel download. Il link potrebbe essere scaduto." -ForegroundColor Red
    Pause
    exit
}

# Analisi Pista
$content = Get-Content $tempFile
$trackLine = $content | Where-Object { $_ -match "Track=" }
$trackInternal = if ($trackLine) { $trackLine.Split("=")[1].Trim().Replace('"', "") } else { "Unknown" }

# Mappa Piste
$trackMap = @{
    "LeMans" = "Lemans"; "Sarthe" = "Lemans";
    "Bahrain" = "Bahrain"; "Sebring" = "Sebring";
    "Portimao" = "Portimao"; "Monza" = "Monza";
    "Spa" = "Spa"; "Fuji" = "Fuji";
    "COTA" = "Circuit Of The Americas"; "Qatar" = "Qatar";
    "Imola" = "Imola"; "Interlagos" = "Interlagos"
}

$destFolder = $null
foreach ($key in $trackMap.Keys) {
    if ($trackInternal -match $key) { $destFolder = $trackMap[$key]; break }
}

if (!$destFolder) {
    Write-Host "`nATTENZIONE: Non riesco a capire la pista ($trackInternal)." -ForegroundColor Yellow
    $settingsPath = "$lmuPath\UserData\player\Settings"
    $folders = Get-ChildItem $settingsPath -Directory
    Write-Host "Seleziona la cartella corretta:"
    for ($i=0; $i -lt $folders.Count; $i++) { Write-Host "$($i+1). $($folders[$i].Name)" }
    $choice = Read-Host "Inserisci il numero"
    $destFolder = $folders[[$int]$choice-1].Name
}

$finalDir = "$lmuPath\UserData\player\Settings\$destFolder"
if (!(Test-Path $finalDir)) { New-Item -ItemType Directory -Path $finalDir | Out-Null }

$fileName = $url.Split("/")[-1].Split("?")[0]
if ($fileName -notmatch "\.svm$") { $fileName = "Imported_Setup.svm" }

Copy-Item $tempFile -Destination "$finalDir\$fileName" -Force

Write-Host "`n✅ SUCCESS!" -ForegroundColor Green
Write-Host "Setup: $fileName" -ForegroundColor White
Write-Host "Pista: $destFolder" -ForegroundColor White
Write-Host "`nIl setup e' pronto nel gioco." -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Pause
