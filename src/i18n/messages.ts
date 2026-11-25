/**
 * 界面文案表。**唯一真相**：默认中文（`zh`），英文（`en`）必须逐键对齐 ——
 * `EN` 的类型是 `Record<MessageKey, string>`，漏一个键就编译不过。
 *
 * 三条约定：
 * 1. 键用「区域.用途」，不按页面分。同一个词在两处出现就叫同一个键，
 *    否则"设置"和"设置面板"迟早翻译成两种说法。
 * 2. 值的语言由键决定，**不要在中文里夹英文**（`⌘`、`KB`、`1:1` 这类符号除外）。
 * 3. 插值只支持 `{name}` 形式的具名占位符：数字排版（中英文空格差异）交给各语言自己写。
 *
 * 欢迎便签的正文（`welcome.body`）也在这里：它是用户能看到的文案，且只在新库里生成一次。
 */

export const ZH = {
  /* ---------------------------------------------------------------- 应用 */
  'app.title': '便签墙',
  'app.description': '无限画布上的便签墙，数据只存在你自己的浏览器里。',

  /* ---------------------------------------------------------------- 控件 */
  'ctl.create': '新建便签',
  'ctl.createTitle': '新建便签（双击空白也可以）',
  'ctl.overviewAria': '查看全部（{n} 张便签）',
  'ctl.overviewTitle': '查看全部（{n} 张）',
  'ctl.settings': '设置',
  'ctl.trash': '废纸篓',
  'ctl.trashTitle': '废纸篓（恢复或清空已删除的便签）',

  /* ---------------------------------------------------------------- 卡片 */
  'note.placeholder': '双击输入…',
  'note.drag': '拖动便签',
  'note.trash': '移入废纸篓',
  'note.copy': '复制为图片',
  'note.copyText': '复制文本（可粘到 Word 等文档）',

  /* ---------------------------------------------------------------- 连线 */
  'link.menuTitle': '已连线（{n}）',
  'link.menuEmpty': '还没有连线',
  'link.menuAdd': '添加连线',
  'link.menuDisconnect': '断开连线',
  'link.menuOpen': '连线列表',
  'link.modeHint': '点击目标便签即可连线',
  'link.modeExit': '退出连线模式',

  /* ---------------------------------------------------------------- 格式条 */
  'fmt.toolbar': '文本格式',
  'fmt.bold': '粗体（⌘/Ctrl+B）',
  'fmt.italic': '斜体（⌘/Ctrl+I）',
  'fmt.strike': '删除线（⌘/Ctrl+Shift+S）',
  'fmt.code': '行内代码（⌘/Ctrl+E）',
  'fmt.link': '插入/编辑链接',
  'fmt.bullet': '无序列表',
  'fmt.ordered': '有序列表',
  'fmt.linkInput': '链接地址',
  'fmt.apply': '应用',

  /* ---------------------------------------------------------------- 图片 */
  'img.external': '外链图片（未加载）',
  'lightbox.hint': '滚轮缩放 · 拖动平移 · 双击 1:1 · Esc 关闭',

  /* ---------------------------------------------------------------- 设置 */
  'settings.title': '设置',
  'settings.close': '关闭设置',
  'settings.language': '语言',
  'settings.languageField': '界面语言',
  'settings.appearance': '外观',
  'settings.background': '背景',
  'settings.palette': '新便签配色',
  'settings.feel': '交互',
  'settings.wheel': '滚轮',
  'settings.wheelPan': '平移画布',
  'settings.wheelZoom': '缩放画布',
  'settings.createMode': '新建方式',
  'settings.createDbl': '双击空白',
  'settings.createFab': '右下角 ＋',
  'settings.mobile': '移动兼容模式',
  'settings.mobileHint': '图标放大，手柄常驻',
  'settings.share': '分享图片',
  'settings.watermark': '加平铺水印',
  'settings.watermarkHint': '导出的图片上斜向铺一层文字，屏幕上不显示',
  'settings.watermarkText': '水印文字',
  'settings.watermarkPlaceholder': '留空则显示「Sticky Wall」',
  'watermark.fallback': 'Sticky Wall',
  'settings.data': '数据',
  'settings.usagePending': '正在统计…',
  'settings.usageUnavailable': '存储用量不可用',
  'settings.usageUsed': '已用 {used}',
  'settings.usageOf': '已用 {used} / 配额 {quota}',
  'settings.exportZip': '导出 ZIP',
  'settings.exportZipTitle': '把墙上全部便签与图片打包下载（不含废纸篓）',
  'settings.importZip': '导入 ZIP',
  'settings.importZipTitle': '从备份包追加便签，不会覆盖现有内容',
  'settings.exportWall': '导出整墙图片',
  'settings.exportWallTitle': '按当前便签布局导出一张大图',
  'settings.help': '帮助',
  'settings.helpTip1': '双击空白：新建便签；双击便签：编辑',
  'settings.helpTip2': '长按便签（桌面 0.4s / 触摸 0.3s）或按住顶部手柄：拖动',
  'settings.helpTip3': '滚轮：按设置平移或缩放；Ctrl/⌘ + 滚轮：始终缩放',
  'settings.helpTip4': 'Esc：关闭窗口 / 取消拖动 / 退出编辑',
  'settings.helpTip5': '删除：卡片右上角 × 移入废纸篓，3 秒内可撤销',
  'settings.helpTip6': '废纸篓（左下）：恢复便签；按住「清空」3 秒才真的清空',
  'settings.helpTip7': '拖入或粘贴图片：建一张图片便签；单击图片看大图',
  'settings.helpTip8': '复制为图片：卡片右上角的图片按钮，把便签变成 PNG 放进剪贴板',
  'settings.helpTip9': '复制为文本：右上角文字按钮，粘到 Word / WPS / 飞书里保留粗体、列表与图片',
  'settings.version': '版本 {v} · MIT 协议',

  /* ---------------------------------------------------------------- 背景 / 配色 */
  'bg.paper': '纸白',
  'bg.kraft': '牛皮纸',
  'bg.grid': '网格纸',
  'bg.blackboard': '黑板',
  'palette.macaron': '马卡龙',
  'palette.monet': '莫奈',

  /* ---------------------------------------------------------------- 移动模式询问 */
  'prompt.mobileTitle': '开启移动兼容模式？',
  'prompt.mobileBody': '图标会变大，并在每张便签顶部常驻拖拽手柄。之后可以在设置里随时改。',
  'prompt.no': '不用了',
  'prompt.yes': '开启',

  /* ---------------------------------------------------------------- 导入导出对话框 */
  'io.exportTitle': '导出整库备份',
  'io.exportBodyNotes': '导出内容包含墙上全部 {n} 张便签及其图片。',
  'io.exportSkipTrash': '废纸篓中的 {n} 张便签不会被导出。',
  'io.exportNoTrash': '废纸篓为空，没有额外内容会被跳过。',
  'io.cancel': '取消',
  'io.export': '导出',
  'io.prefsTitle': '导入设置',
  'io.prefsBodyList': '包里附带的外观设置：{list}',
  'io.prefsBodyAny': '包里附带了一份外观设置。',
  'io.prefsBg': '背景 {v}',
  'io.prefsPalette': '配色 {v}',
  'io.prefsApply': '应用包内的背景与配色',
  'io.importNotes': '导入便签',
  'io.gotIt': '知道了',
  'io.summaryEmptyTitle': '没有导入任何便签',
  'io.summaryEmptyBody': '这个包里没有可识别的便签文件。',
  'io.summaryWrongBundle': '请确认选择的是本站导出的 ZIP 备份。',
  'io.summarySkipped': '跳过 {n} 个无法解析的文件。',
  'io.summaryTitle': '导入完成',
  'io.summaryAdded': '新增 {n} 张便签。',
  'io.summaryRenamed': '其中 {n} 张因 id 重复，已改名 -1 保存。',
  'io.summaryAssetsRenamed': '图片同步改名 {n} 张，正文引用已重写。',
  'io.summaryLinks': '恢复 {n} 条连线。',
  'io.summaryNoSettings': '包里没有外观设置，当前主题保持不变。',
  'io.summaryApplied': '偏好：已应用包内的背景与配色。',
  'io.summaryKept': '偏好：保持当前外观。',

  /* ---------------------------------------------------------------- 废纸篓 */
  'trash.title': '废纸篓',
  'trash.close': '关闭废纸篓',
  'trash.empty': '废纸篓是空的',
  'trash.loadFailed': '读取废纸篓失败',
  'trash.count': '{n} 张',
  'trash.restore': '恢复',
  'trash.restoreAria': '恢复便签：{s}',
  'trash.purgeIdle': '清空废纸篓',
  'trash.purgeHold': '按住 3 秒清空',
  'trash.purgeConfirm': '再点一次清空',
  'trash.gone': '这张便签已经不在废纸篓里了',
  'trash.relocated': '已放到当前视野',
  'trash.restoreFailed': '恢复失败，请再试一次',
  'trash.alreadyEmpty': '废纸篓已经是空的',
  'trash.emptied': '已清空 {n} 张便签',
  'trash.emptiedFreed': '已清空 {n} 张便签，回收 {m} 张图片',
  'trash.purgeFailed': '清空失败，请再试一次',
  'trash.summaryEmpty': '（空便签）',
  'trash.summaryImage': '［图片］',
  'trash.justNow': '刚刚',
  'trash.minutesAgo': '{n} 分钟前',
  'trash.hoursAgo': '{n} 小时前',
  'trash.daysAgo': '{n} 天前',
  'trash.monthDay': '{m} 月 {d} 日',
  'trash.yearMonthDay': '{y} 年 {m} 月 {d} 日',

  /* ---------------------------------------------------------------- 提示条 */
  'toast.trashed': '已移到废纸篓',
  'toast.undo': '撤销',
  'toast.undoFailed': '撤销失败，去废纸篓里找找',
  'toast.imageFailed': '图片处理失败',
  'toast.imageFailedWhy': '图片处理失败：{why}',
  'toast.imageTooLarge': '图片太大，换一张小一点的',
  'toast.imageInsertFailed': '图片插入失败',
  'toast.copied': '已复制为图片',
  'toast.copiedFallback': '这个浏览器不能直接复制图片，已改为下载',
  'toast.copiedText': '已复制文本，可以直接粘到文档里',
  'toast.copiedTextPlain': '这个浏览器只能复制纯文本',
  'toast.copyTextFailed': '复制失败，请再试一次',
  'toast.copyEmpty': '这张便签还是空的',
  'toast.renderFailed': '出图失败，请再试一次',
  'toast.wallEmpty': '墙上还没有便签',
  'toast.exported': '已导出 {n} 张便签',
  'toast.bundleExportFailed': '导出失败，请再试一次',
  'toast.badZip': '这不是一个有效的 ZIP 备份包',
  'toast.importFailed': '导入失败，请检查文件后重试',
  'toast.quota': '存储空间已满，最近的改动没能保存',
  'toast.saveFailed': '保存失败，最近的改动可能丢失',
  'toast.updateReady': '有新版本 · 刷新即可更新',
  'toast.refresh': '刷新',

  /* ---------------------------------------------------------------- 文件名 / 错误 */
  'file.wall': '便签墙',
  'file.noteFallback': '便签',
  'file.bundleTooLarge': '压缩包过大，已中止导入',
  'file.imageTooLarge': '图片过大（{kb}KB）',
  'file.entryTooLarge': '单张图片超过 {mb}MB：{name}',

  /* ---------------------------------------------------------------- 其它 */
  'reset.blocked': '还有其它便签墙页面开着，请全部关掉后重新访问 /?reset=1',

  /* ---------------------------------------------------------------- 首访示例便签 */
  'welcome.body': `**欢迎来到便签墙**

- **双击空白处**：新建一张便签
- **双击便签**：编辑文字
- **长按便签再拖**：挪动位置
- **拖空白处 / 滚轮**：平移画布
- **⌘ + 滚轮 / 双指捏合**：缩放
- 右下角 \`+\` 新建，**概览** 一次看全，**设置** 换材质与配色

这张便签看完就可以删掉。`,
} as const;

export type MessageKey = keyof typeof ZH;

/** 键必须与 ZH 完全一致：漏键/多键都是编译错误，不是"上线后少一句文案" */
export const EN: Record<MessageKey, string> = {
  'app.title': 'Sticky Wall',
  'app.description': 'A sticky wall on an infinite canvas. Everything stays in your own browser.',

  'ctl.create': 'New note',
  'ctl.createTitle': 'New note (or double-click blank space)',
  'ctl.overviewAria': 'Show all ({n} notes)',
  'ctl.overviewTitle': 'Show all ({n})',
  'ctl.settings': 'Settings',
  'ctl.trash': 'Trash',
  'ctl.trashTitle': 'Trash (restore or empty deleted notes)',

  'note.placeholder': 'Double-click to type…',
  'note.drag': 'Drag note',
  'note.trash': 'Move to trash',
  'note.copy': 'Copy as image',
  'note.copyText': 'Copy text (paste into Word or any document)',

  /* ---------------------------------------------------------------- links */
  'link.menuTitle': 'Linked ({n})',
  'link.menuEmpty': 'No links yet',
  'link.menuAdd': 'Add link',
  'link.menuDisconnect': 'Disconnect',
  'link.menuOpen': 'Links',
  'link.modeHint': 'Tap a note to connect',
  'link.modeExit': 'Exit link mode',

  'fmt.toolbar': 'Text formatting',
  'fmt.bold': 'Bold (⌘/Ctrl+B)',
  'fmt.italic': 'Italic (⌘/Ctrl+I)',
  'fmt.strike': 'Strikethrough (⌘/Ctrl+Shift+S)',
  'fmt.code': 'Inline code (⌘/Ctrl+E)',
  'fmt.link': 'Insert or edit link',
  'fmt.bullet': 'Bulleted list',
  'fmt.ordered': 'Numbered list',
  'fmt.linkInput': 'Link address',
  'fmt.apply': 'Apply',

  'img.external': 'External image (not loaded)',
  'lightbox.hint': 'Scroll to zoom · Drag to pan · Double-click for 1:1 · Esc to close',

  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.language': 'Language',
  'settings.languageField': 'Interface language',
  'settings.appearance': 'Appearance',
  'settings.background': 'Background',
  'settings.palette': 'Palette for new notes',
  'settings.feel': 'Interaction',
  'settings.wheel': 'Wheel',
  'settings.wheelPan': 'Pan canvas',
  'settings.wheelZoom': 'Zoom canvas',
  'settings.createMode': 'New note via',
  'settings.createDbl': 'Double-click blank',
  'settings.createFab': 'Bottom-right ＋',
  'settings.mobile': 'Mobile-friendly mode',
  'settings.mobileHint': 'Bigger icons, drag handle always shown',
  'settings.share': 'Sharing images',
  'settings.watermark': 'Tile a watermark',
  'settings.watermarkHint': 'Repeat faint text across exported images (never shown on the wall)',
  'settings.watermarkText': 'Watermark text',
  'settings.watermarkPlaceholder': 'Defaults to “Sticky Wall”',
  'watermark.fallback': 'Sticky Wall',
  'settings.data': 'Data',
  'settings.usagePending': 'Checking…',
  'settings.usageUnavailable': 'Storage usage unavailable',
  'settings.usageUsed': '{used} used',
  'settings.usageOf': '{used} of {quota}',
  'settings.exportZip': 'Export ZIP',
  'settings.exportZipTitle': 'Download every note and image on the wall (trash excluded)',
  'settings.importZip': 'Import ZIP',
  'settings.importZipTitle': 'Append notes from a backup — nothing is overwritten',
  'settings.exportWall': 'Export wall image',
  'settings.exportWallTitle': 'Render the current layout as one large image',
  'settings.help': 'Help',
  'settings.helpTip1': 'Double-click blank space to create; double-click a note to edit',
  'settings.helpTip2': 'Press and hold a note (0.4s mouse / 0.3s touch) or grab the top handle to drag',
  'settings.helpTip3': 'Wheel pans or zooms per settings; Ctrl/⌘ + wheel always zooms',
  'settings.helpTip4': 'Esc closes the window, cancels a drag, or leaves editing',
  'settings.helpTip5': 'Delete: the × on a note moves it to the trash, undoable for 3 seconds',
  'settings.helpTip6': 'Trash (bottom left): restore notes; hold "Empty" for 3 seconds to really empty it',
  'settings.helpTip7': 'Drop or paste an image to create an image note; click an image to enlarge',
  'settings.helpTip8': 'Copy as image: the image button turns a note into a PNG on your clipboard',
  'settings.helpTip9':
    'Copy as text: the text button keeps bold, lists and images when pasted into Word, WPS or Feishu',
  'settings.version': 'Version {v} · MIT license',

  'bg.paper': 'Paper',
  'bg.kraft': 'Kraft',
  'bg.grid': 'Grid paper',
  'bg.blackboard': 'Blackboard',
  'palette.macaron': 'Macaron',
  'palette.monet': 'Monet',

  'prompt.mobileTitle': 'Turn on mobile-friendly mode?',
  'prompt.mobileBody':
    'Icons get bigger and every note keeps a drag handle on top. You can change this later in Settings.',
  'prompt.no': 'Not now',
  'prompt.yes': 'Turn on',

  'io.exportTitle': 'Export full backup',
  'io.exportBodyNotes': 'The export includes all {n} notes on the wall and their images.',
  'io.exportSkipTrash': 'The {n} notes in the trash will not be exported.',
  'io.exportNoTrash': 'The trash is empty, so nothing extra is skipped.',
  'io.cancel': 'Cancel',
  'io.export': 'Export',
  'io.prefsTitle': 'Import settings',
  'io.prefsBodyList': 'Appearance settings in this bundle: {list}',
  'io.prefsBodyAny': 'This bundle carries appearance settings.',
  'io.prefsBg': 'background {v}',
  'io.prefsPalette': 'palette {v}',
  'io.prefsApply': "Apply the bundle's background and palette",
  'io.importNotes': 'Import notes',
  'io.gotIt': 'Got it',
  'io.summaryEmptyTitle': 'No notes were imported',
  'io.summaryEmptyBody': 'This bundle contains no recognisable note files.',
  'io.summaryWrongBundle': 'Make sure you picked a ZIP exported from this app.',
  'io.summarySkipped': 'Skipped {n} unreadable files.',
  'io.summaryTitle': 'Import complete',
  'io.summaryAdded': 'Added {n} notes.',
  'io.summaryRenamed': '{n} of them had duplicate ids and were saved with a -1 suffix.',
  'io.summaryAssetsRenamed': '{n} images were renamed too, and their references rewritten.',
  'io.summaryLinks': 'Restored {n} links.',
  'io.summaryNoSettings': 'The bundle has no appearance settings, so the theme is unchanged.',
  'io.summaryApplied': "Preferences: applied the bundle's background and palette.",
  'io.summaryKept': 'Preferences: kept the current look.',

  'trash.title': 'Trash',
  'trash.close': 'Close trash',
  'trash.empty': 'Trash is empty',
  'trash.loadFailed': "Couldn't read the trash",
  'trash.count': '{n}',
  'trash.restore': 'Restore',
  'trash.restoreAria': 'Restore note: {s}',
  'trash.purgeIdle': 'Empty trash',
  'trash.purgeHold': 'Hold 3s to empty',
  'trash.purgeConfirm': 'Click again to empty',
  'trash.gone': 'That note is no longer in the trash',
  'trash.relocated': 'Moved into the current view',
  'trash.restoreFailed': 'Restore failed, please try again',
  'trash.alreadyEmpty': 'The trash is already empty',
  'trash.emptied': 'Emptied {n} notes',
  'trash.emptiedFreed': 'Emptied {n} notes and reclaimed {m} images',
  'trash.purgeFailed': 'Emptying failed, please try again',
  'trash.summaryEmpty': '(Empty note)',
  'trash.summaryImage': '[Image]',
  'trash.justNow': 'just now',
  'trash.minutesAgo': '{n} min ago',
  'trash.hoursAgo': '{n} h ago',
  'trash.daysAgo': '{n} d ago',
  'trash.monthDay': '{m}/{d}',
  'trash.yearMonthDay': '{y}/{m}/{d}',

  'toast.trashed': 'Moved to trash',
  'toast.undo': 'Undo',
  'toast.undoFailed': 'Undo failed — look in the trash',
  'toast.imageFailed': "Couldn't process the image",
  'toast.imageFailedWhy': "Couldn't process the image: {why}",
  'toast.imageTooLarge': 'That image is too large — try a smaller one',
  'toast.imageInsertFailed': "Couldn't insert the image",
  'toast.copied': 'Copied as image',
  'toast.copiedFallback': "This browser can't copy images — downloaded instead",
  'toast.copiedText': 'Copied — paste it into any document',
  'toast.copiedTextPlain': 'This browser can only copy plain text',
  'toast.copyTextFailed': "Couldn't copy — try again",
  'toast.copyEmpty': 'This note is still empty',
  'toast.renderFailed': 'Rendering failed, please try again',
  'toast.wallEmpty': 'There are no notes on the wall yet',
  'toast.exported': 'Exported {n} notes',
  'toast.bundleExportFailed': 'Export failed, please try again',
  'toast.badZip': "That isn't a valid ZIP backup",
  'toast.importFailed': 'Import failed — check the file and try again',
  'toast.quota': "Storage is full — recent changes weren't saved",
  'toast.saveFailed': 'Save failed — recent changes may be lost',
  'toast.updateReady': 'New version ready · refresh to update',
  'toast.refresh': 'Refresh',

  'file.wall': 'sticky-wall',
  'file.noteFallback': 'note',
  'file.bundleTooLarge': 'The bundle is too large — import stopped',
  'file.imageTooLarge': 'Image too large ({kb}KB)',
  'file.entryTooLarge': 'Image larger than {mb}MB: {name}',

  'reset.blocked': 'Another Sticky Wall tab is still open. Close them all, then revisit /?reset=1',

  'welcome.body': `**Welcome to Sticky Wall**

- **Double-click blank space**: create a note
- **Double-click a note**: edit its text
- **Press and hold, then drag**: move it
- **Drag blank space / scroll**: pan the canvas
- **⌘ + scroll / pinch**: zoom
- Use \`+\` (bottom right) to add, **Overview** to see everything, **Settings** to change material and palette

Feel free to delete this note once you're done.`,
};
