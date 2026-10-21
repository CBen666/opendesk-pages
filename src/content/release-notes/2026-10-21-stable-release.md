---
title: "OpenDesk 0.3.9：任务内容搜索、稳定性修复和长会话性能提升"
date: "2026-10-21T12:00:00+08:00"
category: "stable-release"
version: "0.3.9"
downloads:
  cli: "npm install -g \"@bitclub.ai/opendesk-cli@0.3.9\""
  windows:
    x86:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.9/opendesk-win-x86-0.3.9.exe"
      label: "Windows x86 安装包"
    arm64:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.9/opendesk-win-arm64-0.3.9.exe"
      label: "Windows ARM64 安装包"
  harmonyos:
    url: "https://appgallery.huawei.com/app/detail?id=com.develop.opensource.ohpcd.opendesk&channelId=SHARE&source=appshare"
    label: "HarmonyOS 安装链接"
  macos:
    arm64:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.9/opendesk-darwin-arm64-0.3.9.dmg"
      label: "macOS 安装包 (Apple 芯片)"
    x86:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.9/opendesk-darwin-x86-0.3.9.dmg"
      label: "macOS 安装包 (Intel 芯片)"
summary: "新增基于索引的任务内容全局搜索与缓存命中统计；模型选择、更新下载与安装器体验优化；适配豆包和 DeepSeek 搜索引擎; 消息增量渲染与任务自动卸载降低内存占用，并包含大量界面细节与稳定性修复"
---

# OpenDesk 0.3.9 正式版本更新内容

## 主要更新

相对于 0.3.8 版本，在 0.3.9 版本中我们完成了以下更新:

## UI设计与用户体验优化

- 权限授权弹窗现在会显示触发请求的 shell 名称与具体命令，便于判断是否放行;
- 支持触屏设备的长按触发右键操作, 桌面端右键菜单改为自绘菜单，更好地适应深色主题;
- 修复任务目标面板在窄宽度下的显示;

## 新功能

- 新增任务内容全局搜索：基于本地索引对历史任务内容建立索引，可按关键词检索并快速跳转到对应的对话位置;
- 任务导出的 HTML 支持展开查看工具执行详情;
- 任务视图和个人中心新增缓存命中统计展示，直观反映模型请求的缓存利用情况;
- 支持配置 DeepSeek 和豆包提供的官方搜索引擎, 需配置 DeepSeek API 令牌 和火山引擎 AgentPlan 的 API 令牌使用;

## 其他问题修复

- 上下文压缩前先适配请求输出预算，避免压缩后的请求超出输出限制;
- 消息渲染改为增量 IPC 传输，长对话渲染更快、内存占用更低;
- 后台任务自动卸载到磁盘，降低长时间运行的内存占用;
- 修复模型解码速度估算与显示不准确的问题;
- 修复 grepFile 工具的文件编码检测问题;
- 修复 editFile 工具的行号渲染错误;
- 修复在后台运行的情况下渲染进程由于节流导致被误判为挂死从而重启图形界面的问题;
- 修复安全模式切换 (如标注模式切换到效率模式) 后部分权限请求提示无法被自动授权的问题;
- 修复设置界面同时看到多个模型提供方配置界面的问题;
- 优化 Windows 平台沙箱管控策略，进一步降低授权开销;
- 新增沙箱日志并限制 checkShellStatus 的调用频率，降低后台开销、便于问题诊断;
- 修复安全网关界面显示语言与用户当前语言不匹配的问题;
- Windows 版本安装包支持切换中英文双语言;
- 修复 Windows 安装包在版本相同时无法覆盖安装的问题;
- 修复 Windows X86 平台下安装 Arm64 安装包不报错的问题;
- 修复代理环境下 Windows 平台无法触发自动更新的问题;

## 如何升级

对于 Cli 版本，请运行 `npm install -g "@bitclub.ai/opendesk-cli@0.3.9"` 即可将当前 opendesk 升级到最新的稳定版本，或者进入 opendesk 之后，输入 `/upgrade` 命令即可。桌面端可直接在 [这里](/download/) 下载。
