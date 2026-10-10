$ErrorActionPreference = 'Stop'
# Tạo APK: copy web/ vào assets và build bằng Gradle. Cần JDK 17 + Android SDK (đã cài ở D:\Android\Sdk) + Gradle 8.7 (D:\Android\gradle-8.7).
$jdk = (Get-ChildItem "C:\Program Files\Eclipse Adoptium" | Select-Object -First 1).FullName
$env:JAVA_HOME = $jdk; $env:ANDROID_HOME = 'D:\Android\Sdk'; $env:Path = "$jdk\bin;$env:Path"
Push-Location "$PSScriptRoot\..\android"
& 'D:\Android\gradle-8.7\bin\gradle.bat' --no-daemon -q assembleDebug
Pop-Location
New-Item -ItemType Directory -Force "$PSScriptRoot\..\dist" | Out-Null
Copy-Item "$PSScriptRoot\..\android\app\build\outputs\apk\debug\app-debug.apk" "$PSScriptRoot\..\dist\GameJobAssistant.apk" -Force
Write-Host 'Đã tạo dist\GameJobAssistant.apk'
