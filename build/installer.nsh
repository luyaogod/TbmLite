; TBM Lite NSIS 定制脚本
; 约束：只使用 NSIS 内置指令 + electron-builder 自带发行版中的 WinVer.nsh / LogicLib，
;      不依赖第三方插件（nsProcess / Int64 等），避免因插件缺失导致打包失败或安装中断。

!include "WinVer.nsh"

; ── 安装前检查 ──────────────────────────────────────────
!macro customInit
  ; 1) 系统版本：Electron 30 需要 Windows 10 及以上
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "TBM Lite 需要 Windows 10 或更高版本。$\r$\n当前系统版本过低，安装已终止。"
    Abort
  ${EndIf}

  ; 2) 内部版本号：低于 17763（Win10 1809）时给出可跳过的警告
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $0 != ""
    IntCmpU $0 17763 tbmLiteBuildOk tbmLiteBuildOld tbmLiteBuildOk
    tbmLiteBuildOld:
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "检测到 Windows 内部版本号 $0，低于 TBM Lite 推荐的 17763（Windows 10 1809）。$\r$\n继续安装可能遇到界面或数据库异常。$\r$\n$\r$\n是否继续？" IDOK tbmLiteBuildOk
      Abort
    tbmLiteBuildOk:
  ${EndIf}

  ; 3) 旧版本是否仍在运行：运行中的 exe 无法以写方式打开
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 tbmLiteNoRunningCheck
    ClearErrors
    FileOpen $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
    IfErrors 0 tbmLiteNotRunning
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "TBM Lite 似乎正在运行。$\r$\n请先退出程序再安装，否则可能出现文件占用错误。$\r$\n$\r$\n是否仍要继续？" IDOK tbmLiteNotRunning
      Abort
    tbmLiteNotRunning:
      FileClose $1
  tbmLiteNoRunningCheck:
!macroend

; ── 卸载：询问是否删除用户数据 ──────────────────────────
!macro customUnInstall
  ; 升级安装（isUpdated=1）时不询问，避免自动更新流程被打断
  ${IfNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除 TBM Lite 的用户数据？$\r$\n$\r$\n包含：项目、需求书、附件、AI 配置、会话与备份。$\r$\n位置：$APPDATA\TBM Lite$\r$\n$\r$\n选择「否」将保留数据，重新安装后可继续使用（推荐）。" IDNO tbmLiteKeepData
    RMDir /r "$APPDATA\TBM Lite"
    tbmLiteKeepData:
  ${EndIf}
!macroend
