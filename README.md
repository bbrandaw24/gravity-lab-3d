# 山流实验室 · 雪崩与滑坡 3D

使用 AvaFrame 公开 DEM、释放区与可溯源参数的交互式三维教学仿真。详细输入与方法见 `dist/SOURCES.md`。

## 运行

1. `python -m http.server 8000 --directory dist`
2. 浏览器打开 `http://localhost:8000`。
3. 选择雪崩或滑坡，点击播放；修改参数后点击重新计算。可拖动旋转、缩放、俯视、拖动时间轴、速度着色和导出 CSV。

运行不依赖 CDN，Three.js 已附本地副本；物理计算在 Web Worker 中完成。WebGL 不可用时自动使用 CPU 三维透视显示。

## 验证与重建数据

- `node tests/physics.mjs`
- 若需要从原始输入重建：安装 numpy、scipy 后运行 `python prepare_dem.py`。
- 原始 DEM 与释放文件位于 data；输入冻结到明确的公开 Git 提交。

本程序是深度平均近似，3D 指地形与可视化，不代表完整三维应力计算。滑坡模式将 Shum Wan 文献参数放到 Alplehner DEM 上对照，不能视为该事故复现。没有现场校准，不能用于工程预测。


## GitHub Pages 发布

网站为纯静态文件，所有链接使用相对路径，支持仓库项目网址。

1. 将本工程推送到 GitHub 仓库的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
3. 在 **Actions → Validate and publish GitHub Pages** 中运行工作流，或推送新的提交。
4. 工作流先运行物理校验，再将 `dist/` 发布到 Pages；部署地址显示在工作流与 `github-pages` environment 中。

公开网站只上传 `dist/`。原始数据与转换脚本保存在代码仓库，网站运行无需服务器、API 密钥或外部 CDN。
