# 截图填表方案调研

调研日期：2026-10-27。本轮只做调研，没有修改插件功能，也没有安装或实测新的 OCR 引擎。

## 需求基准

- 截图是主要数据来源，可以是别人发来的图片，来源网页不是必要条件。
- OCR、图片结构分析和保存优先在本机执行，不使用大模型或云端服务。
- 目标网页 DOM 辅助提供字段标签、类型、选项、可写状态和写入后的实际结果。
- 能访问截图的来源网页时，来源 DOM 可提供校对证据；必须与本次截图绑定。
- 自动填写只接受完全同名且唯一的字段；选项也必须完全相同且唯一。
- 保留截图后拖拽和一键填入的交互，不覆盖已有内容，不自动提交。

## 已查看的项目

### Guten OCR：优先验证的浏览器 OCR 候选

- 仓库：https://github.com/gutenye/ocr
- 浏览器入口：https://github.com/gutenye/ocr/blob/main/packages/browser/src/index.ts
- 包配置：https://github.com/gutenye/ocr/blob/main/packages/browser/package.json

已查看 README、浏览器入口和包配置。入口使用 `onnxruntime-web`，注册浏览器图片与文件处理后端；README 提供浏览器部署方式，要求由应用提供检测模型、识别模型和字典。结果包含文字、得分和区域坐标。代码为 MIT 许可，项目说明模型和字典另按上游 PaddleOCR 的 Apache-2.0 许可分发。

适合验证：保留纯浏览器插件，在本地进行文字检测与识别，减少当前手写逐行切分对 OCR 输入的影响。README 建议浏览器优先使用较小模型；不能直接把服务端大模型作为轻量替代。接入前仍需验证模型效果、Manifest V3/CSP、WASM 资源路径、首次加载时间与峰值内存。

本轮没有对用户截图运行这个引擎，不能声称它已经比当前 Tesseract 更准。

### Ui.Vision：OCR 与网页自动化组合的参考

- 仓库：https://github.com/A9T9/RPA
- 本地 OCR 文档：https://ui.vision/rpa/docs/ocr

已查看 README 和官方 OCR 文档。项目组合了网页宏、OCR、图片定位和网页填写；官方文档明确区分本地 JavaScript OCR 与本机 XModule OCR，并提供 OCRExtract、OCRSearch、OCRExtractRelative 等命令。

值得借鉴的是：保留文字坐标，按区域或文字锚点提取内容，将识别结果交给独立的网页动作执行流程，并提供日志。它是自动化工具，现有资料不足以证明它能直接把任意中文表单截图自动迁移到任意网站。也不能照搬其通配符匹配策略，本插件需要完全匹配。

### Bitwarden：目标网页字段采集和事件处理参考

- 仓库：https://github.com/bitwarden/clients
- 字段采集：https://github.com/bitwarden/clients/blob/main/apps/browser/src/autofill/services/collect-autofill-content.service.ts
- 写入：https://github.com/bitwarden/clients/blob/main/apps/browser/src/autofill/services/insert-autofill-content.service.ts

已查看自动填充服务，以及采集和写入服务的相关代码。采集层涉及动态 DOM、Shadow DOM 和 iframe；写入层分别处理值、勾选状态、焦点以及 input/change 等事件。

值得借鉴字段采集、动作与事件处理的分工，以及动态页面中的重新定位。它不负责截图 OCR，其登录表单判断规则不能直接泛化为业务表单。仓库包含 GPLv3 与 Bitwarden 许可，参考设计和直接复用代码需要分别评估。

### Automa：按控件类型执行填写的参考

- 仓库：https://github.com/AutomaApp/automa
- 表单动作：https://github.com/AutomaApp/automa/blob/main/src/content/blocksHandler/handlerForms.js
- 控件处理：https://github.com/AutomaApp/automa/blob/main/src/utils/handleFormElement.js

已查看 README、表单动作与控件处理代码。实现区分文字输入、contenteditable、checkbox/radio、原生 select，并包含 React 输入值跟踪处理和事件派发。部分输入路径可经 debugger 执行。

值得借鉴按控件类型分派动作与处理框架事件的方式。当前代码不意味着能直接支持全部自定义下拉组件，也不应为普通填写直接引入 debugger 权限。仓库有 AGPL 和商业许可，不能无评估地复制代码。

### RapidOCR / Umi-OCR：可选的本机增强路线

- RapidOCR：https://github.com/RapidAI/RapidOCR
- Umi-OCR：https://github.com/hiroi-sora/Umi-OCR
- Umi-OCR 图片接口：https://github.com/hiroi-sora/Umi-OCR/blob/main/docs/http/api_ocr.md

已查看项目 README 和 Umi-OCR HTTP 图片接口。RapidOCR 提供离线、多平台 OCR 部署；Umi-OCR 可通过本机 HTTP 接收图片，返回文字、可信度和四角坐标，并支持不做排版合并。

适合纯浏览器方案效果或性能不足时作为可选本机引擎。代价是额外运行本机程序，不是零安装的纯插件方案。本轮不改变当前交付方式。

### PaddleOCR 文档版面解析的适用边界

- PP-StructureV3：https://www.paddleocr.ai/main/version3.x/pipeline_usage/PP-StructureV3.html
- Paddle.js 浏览器 OCR：https://github.com/PaddlePaddle/Paddle.js/tree/master/packages/paddlejs-models/ocr

已查看 PP-StructureV3 官方文档和 Paddle.js OCR README。前者主要面向文档中的段落、标题、表格、图片等版面元素，不能据此推断它能直接识别网页截图中的开关、已选标签或自定义下拉状态。Paddle.js 展示了中文、英文、数字 OCR 和坐标检测的浏览器运行方式，但所查看示例使用 PP-OCRv2，仍需与其他候选比较后选型。

## 当前插件中已核实的问题

1. `src/ocr.js` 先按手写规则切文本行和列，再用单行模式识别；`src/core.js` 用间距和边框推断标签和值。这种组合对多选标签、跨行标签、左右两个输入框等结构容易误切或遗漏。
2. 当前截图预处理统一转灰度并提高对比度，没有独立的控件状态图像分析。文字 OCR 本身不能替代开关、checkbox 和多选标签边界的判别；原彩图像应为后续分析保留。
3. `src/panel.js` 把提取到的 OCR 字段统一设为 `confirmed: true`，即使它携带低可信度信息。默认参与填写不能等同于已经核对正确。
4. 当前混合模式同名字段以来源网页值优先，并且 OCR 误读的字段名可能成为另一条记录，混合结果缺少清晰的来源和冲突说明。
5. 目标扫描与消息主要限定主 frame，`扫描到控件` 不等于 `读到明确标签` 或 `能够写入并验证`。

这些是当前实现的问题，不足以证明更换任一引擎即可修好全部流程。

## 建议验证顺序

1. 先比较当前 Tesseract 与 Guten OCR 的纯图片识别。使用经人工标注的中文、英文、数字、URL、正则表达式和压缩截图；必须包含无来源网页的图片。记录字段名和值逐字正确率、遗漏、错误配对、耗时及内存，不以识别行数作为成功标准。
2. 使用文字区域坐标与原图控件边界组织字段、值、选项标签和组合行。文字、控件状态和字段对应关系分别保留可信度。目标标签可用于提示和二次裁剪复识别，不能把近似名字直接视为完全匹配。
3. 将目标扫描、精确匹配、各控件动作、读回验证分别验收。覆盖原生控件、React/Vue、常用 UI 组件、异步选项、多表单、重复标签和 iframe；遇到不支持的结构给出具体原因。
4. 最后验证截图/粘贴/拖入图片到填写的完整体验，以及从插件窗口拖到同屏目标表单的流程。

控件截图状态存在歧义时保留人工核对入口。截图上的普通按钮不能仅凭外观视为待复制状态，更不能自动点击提交、删除或执行类按钮。

## 本轮结论

优先验证 Guten OCR 作为纯浏览器识别候选；参考 Ui.Vision 的区域提取和动作执行流程，参考 Bitwarden / Automa 的目标控件采集与事件处理。RapidOCR / Umi-OCR 作为可选本机增强路线保留。是否替换引擎应由截图基准结果决定，不能仅凭项目介绍作出结论。

GitHub 直连和搜索接口本轮多次连接失败，仓库文档与代码通过 jsDelivr 对应的原仓库文件读取；官方文档通过项目网站读取。所看分支为当时的 main/master，未固定提交，因此实现前需锁定版本并重新核对许可证和依赖。

## 后续实施与复测：0.6.0

本节记录用户批准尝试后的实施结果，前文为实施之前的调研记录。

- 锁定 @gutenye/ocr-browser 1.4.9、依赖锁中的 onnxruntime-web 1.31.1 和模型包 1.4.2。PP-OCRv4 模型与字典随包分发，并记录 SHA-256。
- 普通 MV3 页面直接运行 OpenCV 依赖会触发 CSP 错误。改在无扩展权限的 sandbox 页面运行；扩展页 CSP 不增加 unsafe-eval。sandbox 禁止 HTTP/HTTPS 连接，只加载包内代码、模型和 WASM。
- 避免上游整页识别自动合并同一行的多个字段：检测后逐区域识别，保留各自坐标。中英文混排标签使用局部 Tesseract 复核空格，匹配层仍严格比较最终原文，不做近义、大小写或空格模糊匹配。
- 用户此前提供的横排截图在离线 Edge 扩展实测中保留了名称、Prometheus、优先级 20，以及 severity / P[0-2] 两个组合子项。图片多选文字能保留，但没有 DOM 时不据此推断真实选中数组；图片开关状态仍需核对。该用户截图仅用于本机诊断，不放入交付源码和测试素材。
- 新增结构化组与来源合并单元测试，以及无来源 DOM 的生成图片到目标网页的端到端测试。目标子项顺序相反时按明确 key/value 标识写入；已有文字子项跳过整组；页面联动改变后续子项时停止写入。
- 浏览器自动化通过不代表实际业务站点全覆盖，也不代表 Windows 物理鼠标跨窗口拖动已现场验证；交付说明保留这一边界。
