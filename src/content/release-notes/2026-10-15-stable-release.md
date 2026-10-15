---
title: "OpenDesk 0.3.8：文件回收站，任务极简模式显示和对话快速导航"
date: "2026-10-15T12:00:00+08:00"
category: "stable-release"
version: "0.3.8"
downloads:
  cli: "npm install -g \"@bitclub.ai/opendesk-cli@0.3.8\""
  windows:
    x86:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.8/opendesk-win-x86-0.3.8.exe"
      label: "Windows x86 安装包"
    arm64:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.8/opendesk-win-arm64-0.3.8.exe"
      label: "Windows ARM64 安装包"
  harmonyos:
    url: "https://appgallery.huawei.com/app/detail?id=com.develop.opensource.ohpcd.opendesk&channelId=SHARE&source=appshare"
    label: "HarmonyOS 安装链接"
  macos:
    arm64:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.8/opendesk-darwin-arm64-0.3.8.dmg"
      label: "macOS 安装包 (Apple 芯片)"
    x86:
      url: "https://gitcode.com/openharmony-robot/OpenDesk/releases/download/v0.3.8/opendesk-darwin-x86-0.3.8.dmg"
      label: "macOS 安装包 (Intel 芯片)"
summary: "支持 Linux 与 OpenHarmony 平台的动态沙箱，并在沙箱的基础上增加文件回收站帮用户找回误删文件；新增极简/详细两种输出模式；内置浏览器支持账号密码保存与自动填充；同时包含渲染内存优化、模型错误提示改进与大量稳定性修复"
---

# OpenDesk 0.3.8 正式版本更新内容

## 主要更新

相对于 0.3.7 版本，在 0.3.8 版本中我们完成了以下更新:

## UI设计与用户体验优化

- 新增极简模式与详细模式两种输出模式，极简模式下滚动显示任务的当前状态，默认不再展开工具执行的细节，用户可以在设置菜单中切换两种不同的显示模式;
- 对话左侧增加轮次快速导航，可以快速定位到过去的对话位置;
- Linux 版本通过自绘方式提供带圆角的窗口边框，与其他平台保持体验一致;
- 用户消息新增 "重新发送" 入口，支持保留现有对话、把历史请求原样追加到会话末尾重发;
- 
## 新功能

- 通过用户态文件系统实现 Linux 平台下的终端动态沙箱；
- 基于 libc 用户态钩子实现 OpenHarmony 下的终端动态沙箱 (支持 zsh/bash) ;
- 支持文件回收站功能，可以将所有 Agent 删除的文件备份，7天之内可以通过回收站界面找回，当前需要用户在任务设置中启用沙箱并开启"将删除的文件放到回收站";
- 内置浏览器新增账号密码管理: 识别登录表单并询问是否保存，密码经系统加密存储，任务浏览器菜单提供"清除密码"入口;
- 插件系统中 `shell.env` 钩子入参新增 shell 类型信息 (bash/zsh/powershell)，插件可按实际使用的 shell 注入环境；

## 其他问题修复

- 模型配置支持从提供方拉取模型列表后选择，同时保留手动填写模型名;
- 淘汰长时间未使用的任务视图，超大单轮对话避免重复渲染，降低持续内存占用;
- 标准模式补充常用非凭据路径与系统目录的只读放行，可写性探测、打开目录、不存在的文件等情况下不再弹出授权请求，减少用户的授权次数;
- 用户消息的操作区分"重新执行"（删除后续内容后重跑该条消息）与"重新发送"（在对话末尾再次发送）;
- Windows 动态沙箱改用 Microsoft Detours 进行 API 钩子拦截重写，优化高频文件读写性能，并且不再依赖虚拟盘符;
- 存储层统一数据库资源生命周期，文件索引统计改为在存储层聚合，SQLite 不可用时安全降级到 WASM 数据库；
- 文件索引状态在存储后端或嵌入模型变更后正确对齐，不再残留过期向量与分块;
- 修复打包产物中 asar 路径导致安全网关启动失败的问题;
- 区分模型服务返回错误与网络请求错误，对于显然无法通过重试恢复的错误，不再进行自动重试；
- 模型请求默认超时调整为 300 秒, 对于超长上下文场景首次请求的情况下;
- 修复上下文压缩过程中的用量恢复与文件读取状态压缩问题，长会话压缩更稳定;
- 优化 Windows 安装包体积;
- 修复 Linux 下打开文件夹时的死锁，以及 shell 输出流的解码问题;
- 修复浏览器控制中由于 Electron 内部失效导致标签页卡死的问题，当前通过自动恢复机制规避;
- 修复 grep 工具在部分场景下行号错乱的问题；
- 修复 readFile 工具中，长 ASCII 序列开头的文件无法正确识别编码的问题；
- 修复 Windows 下文件预览面板面包屑路径错误;
- 修复任务开始时直接输入 Goal 可能导致不触发任务自动命名的问题;
- 修复侧边栏切换应用后导航高亮丢失的问题;
- 修复 MCP 市场中，ModelScope 模型列表分页重复的问题；
- 修正 deepseek-v4.1-flash 的视觉能力识别，并更新 qwen3.8-flash-next 的模型信息;
- 修复从"记忆"面板切换至"文件系统"时左侧导航按钮不高亮的问题;
- 修复 Windows 上复制 PPT 中的文字粘贴到 OpenDesk 总显示为图片的问题;
- 修复对于图片信息token估算不准确的问题；
- 修复文字内容被波浪号包裹时, 在桌面端任务显示时出现删除线的问题;
- 通过 ACP 接入三方智能体时，自动释放空闲连接避免耗尽单主机 socket 上限;
- 内置技能按配置的平台加载，依赖宿主内联渲染能力的技能不再注入 Cli；
- GPU 渲染进程失败后自动恢复，避免界面长时间白屏;
- 修复由于依赖缺失导致的部分环境下的遥测初始化失败问题;
- 左侧边栏宽度不足时按钮自动收起文字仅保留图标，目标面板在窄宽度下正常显示;
- 深色模式下 askUser、退出计划与权限弹窗样式修正，浅色模式下提示面板外观修正，工具块与提示词边距统一;
- 修复多行代码块渲染时的行号显示错误;
- 任务悬浮窗可以在小窗中永久关闭;

## 如何升级

对于 Cli 版本，请运行 `npm install -g "@bitclub.ai/opendesk-cli@0.3.8"` 即可将当前 opendesk 升级到最新的稳定版本，或者进入 opendesk 之后，输入 `/upgrade` 命令即可。桌面端可直接在 [这里](/download/) 下载。
