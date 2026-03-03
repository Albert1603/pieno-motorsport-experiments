@findstr /v "^@.*" "%~f0" | powershell -NoProfile -ExecutionPolicy Bypass - & goto :eof

# --- Le Mans Ultimate Telemetry Suite - Single-File Installer ---
try {
    $DAM_URL = "https://forum.studio-397.com/index.php?attachments/rf2_damplugin_v0_931_manualinstall-zip.51620/"
    $MOTEC_URL = "https://moteconline.motec.com.au/ResourceDownload/DownloadPayload?ResourceTypeName=Software&ResourceName=i2pRelease&Version=01.01.04.0456"
    $TEMP_DIR = "$env:TEMP\LMU_Telemetry_Install"

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

    Write-Host "`n>>> Starting LMU Telemetry Suite Installation..." -ForegroundColor Cyan
    $lmuPath = Get-LMUPath
    if (!$lmuPath) {
        Write-Host "WARNING: Could not find Le Mans Ultimate automatically." -ForegroundColor Yellow
        $lmuPath = Read-Host "Please paste your 'Le Mans Ultimate' folder path"
    }

    if (-not (Test-Path "$lmuPath\Le Mans Ultimate.exe")) {
        throw "The path provided does not contain Le Mans Ultimate.exe. Aborting."
    }

    Write-Host ">>> LMU found at: $lmuPath" -ForegroundColor Green

    # --- Setup Temp Directory ---
    if (Test-Path $TEMP_DIR) { Remove-Item $TEMP_DIR -Recurse -Force }
    New-Item -ItemType Directory -Path $TEMP_DIR | Out-Null

    # 1. Download & Install DAMPlugin
    Write-Host "`n>>> Step 1: Installing DAMPlugin..." -ForegroundColor Yellow
    $zipPath = "$TEMP_DIR\DAMPlugin.zip"
    Write-Host "Downloading DAMPlugin..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $DAM_URL -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath "$TEMP_DIR\Extract" -Force

    if (!(Test-Path "$lmuPath\Plugins")) { New-Item -ItemType Directory -Path "$lmuPath\Plugins" | Out-Null }
    if (!(Test-Path "$lmuPath\PluginData")) { New-Item -ItemType Directory -Path "$lmuPath\PluginData" | Out-Null }

    $dllSource = "$TEMP_DIR\Extract\Bin64\Plugins\DAMPlugin.dll"
    if (Test-Path $dllSource) {
        Copy-Item $dllSource -Destination "$lmuPath\Plugins" -Force
        Write-Host "DAMPlugin.dll installed." -ForegroundColor Green
    } else {
        throw "Could not find DAMPlugin.dll in extracted files."
    }
    
    Copy-Item -Recurse "$TEMP_DIR\Extract\PluginData\DAMPlugin" -Destination "$lmuPath\PluginData" -Force
    Write-Host "PluginData folder installed." -ForegroundColor Green

    # 2. Enable in JSON
    Write-Host "`n>>> Step 2: Enabling Plugin in Game Configuration..." -ForegroundColor Yellow
    $jsonPath = "$lmuPath\Plugins\CustomPluginVariables.JSON"
    if (Test-Path $jsonPath) {
        $rawJson = Get-Content $jsonPath -Raw
        $json = if ([string]::IsNullOrWhiteSpace($rawJson)) { @{} } else { $rawJson | ConvertFrom-Json }
        
        if (-not $json.PSObject.Properties["DAMPlugin.dll"]) {
            $json | Add-Member -MemberType NoteProperty -Name "DAMPlugin.dll" -Value @{ " Enabled" = 1 }
            $json | ConvertTo-Json -Depth 5 | Set-Content $jsonPath
            Write-Host "Plugin enabled in CustomPluginVariables.JSON" -ForegroundColor Green
        }
    } else {
        $newJson = @{ "DAMPlugin.dll" = @{ " Enabled" = 1 } }
        $newJson | ConvertTo-Json -Depth 5 | Set-Content $jsonPath
        Write-Host "Created configuration and enabled DAMPlugin." -ForegroundColor Green
    }

    # 3. Create Telemetry Shortcut
    Write-Host "`n>>> Step 3: Creating Desktop Shortcut to Logs..." -ForegroundColor Yellow
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\LMU Telemetry Logs.lnk")
    $Shortcut.TargetPath = "$lmuPath\LOG"
    $Shortcut.Save()
    Write-Host "Shortcut created on Desktop." -ForegroundColor Green

    # 4. MoTeC i2 Pro Download & Launch
    Write-Host "`n>>> Step 4: Installing MoTeC i2 Pro..." -ForegroundColor Yellow
    $motecExe = "$TEMP_DIR\MoTeC_i2_Pro_Setup.exe"
    Write-Host "Downloading MoTeC i2 Pro (this may take a minute)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $MOTEC_URL -OutFile $motecExe
    
    Write-Host "Launching MoTeC Installer. Please complete setup manually." -ForegroundColor Green
    Start-Process -FilePath $motecExe -Wait

    Write-Host "`n===============================================" -ForegroundColor Green
    Write-Host "INSTALLATION COMPLETE!" -ForegroundColor Green
    Write-Host "Le Mans Ultimate is now ready for telemetry logging."
    Write-Host "===============================================" -ForegroundColor Green
    
    Remove-Item $TEMP_DIR -Recurse -Force

} catch {
    Write-Host "`nERROR OCCURRED:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "`nPlease run as Administrator if problems persist." -ForegroundColor Yellow
}

Write-Host "`nPress any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
