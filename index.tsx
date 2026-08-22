// 批量条形码生成器 · Scripting 声明式 UI 版本
import {
  Script,
  Navigation,
  NavigationStack,
  ScrollView,
  ScrollViewReader,
  ScrollViewProxy,
  VStack,
  HStack,
  ZStack,
  Text,
  TextField,
  Button,
  Image,
  Spacer,
  modifiers,
  useState,
  useRef,
  useKeyboardVisible,
  RoundedRectangle,
  ImageRenderer,
  ColorPicker,
  Toggle,
  Picker,
  Slider,
} from "scripting"
import {
  BarcodeCanvas,
  BarcodeItem,
  BarcodeType,
  BARCODE_TYPES,
  typeName,
  encodeBarcode,
  scanTexts,
  StyleSettings,
  DEFAULT_STYLE,
} from "./barcode_core"

// alert 是 Scripting 运行时提供的全局函数，类型检查器未收录，这里补充声明
// 以便消除误报（不影响运行时行为）
declare function alert(message: string): Promise<void>
// Dialog 模块（文档确认：输入弹窗用 Dialog.prompt，无需 import）
declare const Dialog: {
  alert(options: {
    message: string
    title?: string
    buttonLabel?: string
  }): Promise<void>
  prompt(options: {
    title: string
    message?: string
    defaultValue?: string
    obscureText?: boolean
    selectAll?: boolean
    placeholder?: string
    cancelLabel?: string
    confirmLabel?: string
    keyboardType?: string
  }): Promise<string | null>
  actionSheet(options: {
    title: string
    message?: string
    cancelButton?: boolean
    actions: { label: string; destructive?: boolean }[]
  }): Promise<number | null>
}

// 生成条码之间的间距：1cm + 0.3mm（1mm ≈ 2.835pt）
const BARCODE_GAP = 28.35 + 0.85

// 最近生成历史持久化 key 与最大条数
const HISTORY_KEY = "recent_history"
const HISTORY_MAX = 20
// 收藏持久化 key（收藏不限数量）
const FAVORITES_KEY = "favorites"
// 样式设置持久化 key
const SETTINGS_KEY = "style_settings"

// 历史条目：一次生成的内容集合与时间
// 收藏条目：自定义名称 + 内容集合 + 文件夹（空字符串表示未分类）
type HistoryItem = { id: string; texts: string[]; time: number }
type FavoriteItem = {
  id: string
  name: string
  texts: string[]
  time: number
  folder: string
}
function makeRowId(): string {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// 读取/保存最近生成历史（Storage 全局 API，持久化到当前脚本私有域）
function loadHistory(): HistoryItem[] {
  const saved = Storage.get<HistoryItem[]>(HISTORY_KEY)
  return Array.isArray(saved) ? saved : []
}
function saveHistory(items: HistoryItem[]) {
  Storage.set(HISTORY_KEY, items)
}
// 读取/保存收藏（兼容旧数据：无 folder 字段的视为未分类）
function loadFavorites(): FavoriteItem[] {
  const saved = Storage.get<FavoriteItem[]>(FAVORITES_KEY)
  if (!Array.isArray(saved)) return []
  return saved.map((f) => ({ ...f, folder: typeof f.folder === "string" ? f.folder : "" }))
}
function saveFavorites(items: FavoriteItem[]) {
  Storage.set(FAVORITES_KEY, items)
}
// 读取/保存样式设置（与默认值合并，兼容旧数据/新字段）
function loadSettings(): StyleSettings {
  const saved = Storage.get<Partial<StyleSettings>>(SETTINGS_KEY)
  return { ...DEFAULT_STYLE, ...(saved && typeof saved === "object" ? saved : {}) }
}
function saveSettings(settings: StyleSettings) {
  Storage.set(SETTINGS_KEY, settings)
}

// 按「外观」设置返回传给根 ScrollView 的 preferredColorScheme 属性。
// 文档：preferredColorScheme 作为「属性」传入才生效（示例 <List preferredColorScheme="dark">），
// 影响视图层级的非临时系统浮层；跟随系统则不传该属性。
// 注意：导航 push 出的独立页面不继承来源页的颜色方案，因此需在每个导航页面的根 ScrollView 上分别应用。
function schemeProps(colorScheme: "system" | "light" | "dark") {
  return colorScheme === "system"
    ? {}
    : { preferredColorScheme: (colorScheme as "light" | "dark") }
}

// ===== 显式主题：让「外观」强制深/浅色真正作用于全脚本页面内容 =====
// 关键：本框架里 preferredColorScheme 只影响非临时系统浮层（文档明确）；而 label/secondaryLabel/
// 材质等语义样式按「设备」深浅色解析，无法由 preferredColorScheme 强制。用户连点深/浅都无变化正是因此。
// 所以按用户选择的 colorScheme 取色：跟随系统→语义色（系统按设备深浅色原生自适应）；浅/深→用下方调色板显式颜色强制替换。
type CS = "system" | "light" | "dark"
// 主题调色板：light / dark 两套
const THEME = {
  pageBg:   { light: "#ffffff", dark: "#000000" },                 // 页面/系统背景（浅色对齐 systemBackground 纯白，使「浅色」与「跟随系统-浅色」一致）
  label:    { light: "#111111", dark: "#f5f5f7" },                 // 主要文字
  sub:      { light: "#6b7280", dark: "#a6a6ab" },                 // 次要文字/中性图标（原 secondaryLabel）
  card:     { light: "rgba(224,226,234,0.72)", dark: "rgba(44,44,46,0.62)" }, // 玻璃卡片（浅色改为白底上可见的浅灰玻璃，替代 ultraThinMaterial）
  capsule:  { light: "rgba(255,255,255,0.9)", dark: "rgba(58,58,60,0.9)" },   // 输入胶囊（替代 regularMaterial）
  input:    { light: "#4B5563", dark: "#e5e7eb" },                 // 输入框文字
} as const
type ThemeColor = { light: string; dark: string }
// 取色：跟随系统→语义色（label/secondaryLabel/材质/系统背景，按设备深浅色自动解析）；浅/深→强制调色板显式色。
// 返回 any 以兼容 background/foregroundStyle 的 ShapeStyle 字面量联合类型。
function lab(cs: CS): any { return cs === "system" ? "label" : cs === "dark" ? THEME.label.dark : THEME.label.light }
function sub(cs: CS): any { return cs === "system" ? "secondaryLabel" : cs === "dark" ? THEME.sub.dark : THEME.sub.light }
function cardB(cs: CS): any { return cs === "system" ? "ultraThinMaterial" : cs === "dark" ? THEME.card.dark : THEME.card.light }
function capB(cs: CS): any { return cs === "system" ? "regularMaterial" : cs === "dark" ? THEME.capsule.dark : THEME.capsule.light }
function pageB(cs: CS): any { return cs === "system" ? "systemBackground" : cs === "dark" ? THEME.pageBg.dark : THEME.pageBg.light }
function inputT(cs: CS): any { return cs === "system" ? "label" : cs === "dark" ? THEME.input.dark : THEME.input.light }

// 全屏背景包装：把页面内容包进 <ZStack>，用一块「忽略安全区、铺满整屏」的背景放在内容(ScrollView)的兄弟层。
// 这样背景覆盖到状态栏与底部指示条（解决顶部/底部白边），而不像 <ScrollView>.background 那样只盖内容区，
// 也不像 <ScrollView>.ignoresSafeArea() 那样把工具栏/按钮推入安全区、移位内容，更不会像 ScrollView 背景内
// frame('infinity') 那样触发无限布局循环（这里背景是 ZStack 兄弟层，尺寸有界，可安全填满）。
function FullScreenBg({ cs, children }: { cs: CS; children: any }) {
  return (
    <ZStack>
      <VStack
        modifiers={modifiers()
          .frame({ maxWidth: "infinity", maxHeight: "infinity" })
          .background({ style: pageB(cs), shape: { type: "rect", cornerRadius: 0 } })
          .ignoresSafeArea()}
      />
      {children}
    </ZStack>
  )
}

// 设置页：样式设置（条码颜色/背景颜色/显示文字/文字位置/文字大小/条码高度/条码宽度/边距）

// 数值调节行：右侧滑杆调节（min/max 约束），最右侧固定显示当前值与单位
function SliderRow({
  title,
  value,
  min,
  max,
  step,
  unit,
  onValue,
  cs,
}: {
  title: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onValue: (v: number) => void
  cs: CS
}) {
  return (
    <HStack
      alignment="center"
      spacing={10}
      modifiers={modifiers()
        .frame({ maxWidth: 'infinity' })
        .padding(14)
        .background({
          style: cardB(cs),
          shape: { type: "rect", cornerRadius: 16 },
        })}
    >
      <Text
        font={16}
        fontWeight="bold"
        modifiers={modifiers().foregroundStyle(lab(cs))}
      >
        {title}
      </Text>
      <Spacer />
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChanged={onValue}
        modifiers={modifiers().frame({ width: 170 })}
      />
      <Text
        font={15}
        fontWeight="bold"
        modifiers={modifiers()
          .foregroundStyle("#3b82f6")
          .frame({ width: 60, alignment: 'trailing' })}
      >
        {Math.round(value * 10) / 10}{unit ?? ""}
      </Text>
    </HStack>
  )
}

function SettingsPage({
  settings,
  onChange,
  onClose,
}: {
  settings: StyleSettings
  onChange: (patch: Partial<StyleSettings>) => void
  onClose: () => void
}) {
  // 当前外观设置（供根视图 themedMods 使用）
  const colorScheme = settings.colorScheme
  // 设置项卡片样式
  function cardMods() {
    return modifiers()
      .frame({ maxWidth: 'infinity' })
      .padding(14)
      .background({
        style: cardB(colorScheme),
        shape: { type: "rect", cornerRadius: 16 },
      })
  }

  return (
    <FullScreenBg cs={colorScheme}>
    <ScrollView
      {...schemeProps(colorScheme)} modifiers={modifiers()
        .frame({ maxWidth: 'infinity', maxHeight: 'infinity' })
        .navigationBarVisibility("hidden")
        .safeAreaInset({
          top: {
            alignment: 'leading',
            spacing: 0,
            content: (
              <HStack
                modifiers={modifiers()
                  .frame({ maxWidth: 'infinity' })
                  .padding({ top: 14.175, leading: 14.175, trailing: 14.175 })}
              >
                <Button
                  action={onClose}
                  modifiers={modifiers()
                    .frame({ width: 52, height: 52, alignment: 'center' })
                    .padding(0)
                    .font(22)
                    .fontWeight("bold")
                    .foregroundStyle("#3b82f6")
                    .contentShape({ type: "rect", cornerRadius: 16 })}
                >
                  <Image systemName="chevron.left" renderingMode="template" />
                </Button>
                <Spacer />
              </HStack>
            ),
          },
        })}
    >
      <VStack alignment="leading" spacing={14} padding={16}>
        <Text
          font={26}
          fontWeight="bold"
          modifiers={modifiers().foregroundStyle(lab(colorScheme))}
        >
          样式设置
        </Text>

        {/* 外观：跟随系统 / 浅色 / 深色 */}
        <HStack alignment="center" spacing={10} modifiers={cardMods()}>
          <Text
            font={16}
            fontWeight="bold"
            modifiers={modifiers().foregroundStyle(lab(colorScheme))}
          >
            外观
          </Text>
          <Spacer />
          <Picker
            label={
              <HStack spacing={4}>
                <Text
                  font={15}
                  modifiers={modifiers().foregroundStyle("#3b82f6")}
                >
                  {colorScheme === "system"
                    ? "跟随系统"
                    : colorScheme === "light"
                    ? "浅色"
                    : "深色"}
                </Text>
                <Image
                  systemName="chevron.down"
                  renderingMode="template"
                  modifiers={modifiers().font(12).foregroundStyle("#8e8e93")}
                />
              </HStack>
            }
            value={colorScheme}
            onChanged={(v: string) =>
              onChange({ colorScheme: v as "system" | "light" | "dark" })
            }
            pickerStyle="menu"
          >
            <Text tag="system">跟随系统</Text>
            <Text tag="light">浅色</Text>
            <Text tag="dark">深色</Text>
          </Picker>
        </HStack>

        {/* 条码颜色：点击弹出系统颜色选择器 */}
        <HStack alignment="center" spacing={10} modifiers={cardMods()}>
          <Text
            font={16}
            fontWeight="bold"
            modifiers={modifiers().foregroundStyle(lab(colorScheme))}
          >
            条码颜色
          </Text>
          <Spacer />
          <ColorPicker
            value={settings.barColor as any}
            supportsOpacity={false}
            onChanged={(c) => onChange({ barColor: c })}
          >
            <HStack spacing={8}>
              <VStack
                modifiers={modifiers()
                  .frame({ width: 26, height: 26, alignment: 'center' })
                  .background({ style: settings.barColor as any, shape: "circle" })}
              />
              <Text
                font={14}
                modifiers={modifiers().foregroundStyle("#8e8e93")}
              >
                {settings.barColor}
              </Text>
            </HStack>
          </ColorPicker>
        </HStack>

        {/* 背景颜色：点击弹出系统颜色选择器 */}
        <HStack alignment="center" spacing={10} modifiers={cardMods()}>
          <Text
            font={16}
            fontWeight="bold"
            modifiers={modifiers().foregroundStyle(lab(colorScheme))}
          >
            背景颜色
          </Text>
          <Spacer />
          <ColorPicker
            value={settings.bgColor as any}
            supportsOpacity={false}
            onChanged={(c) => onChange({ bgColor: c })}
          >
            <HStack spacing={8}>
              <VStack
                modifiers={modifiers()
                  .frame({ width: 26, height: 26, alignment: 'center' })
                  .background({ style: settings.bgColor as any, shape: "circle" })}
              />
              <Text
                font={14}
                modifiers={modifiers().foregroundStyle("#8e8e93")}
              >
                {settings.bgColor}
              </Text>
            </HStack>
          </ColorPicker>
        </HStack>

        {/* 显示文字 */}
        <VStack alignment="leading" spacing={6} modifiers={cardMods()}>
          <Toggle
            value={settings.showText}
            onChanged={(v) => onChange({ showText: v })}
          >
            <Text
              font={16}
              fontWeight="bold"
              modifiers={modifiers().foregroundStyle(lab(colorScheme))}
            >
              显示文字
            </Text>
          </Toggle>
        </VStack>

        {/* 显示条码格式 */}
        <VStack alignment="leading" spacing={6} modifiers={cardMods()}>
          <Toggle
            value={settings.showFormat}
            onChanged={(v) => onChange({ showFormat: v })}
          >
            <Text
              font={16}
              fontWeight="bold"
              modifiers={modifiers().foregroundStyle(lab(colorScheme))}
            >
              显示条码格式
            </Text>
          </Toggle>
        </VStack>

        {/* 文字位置：下拉菜单选择 */}
        <HStack alignment="center" spacing={10} modifiers={cardMods()}>
          <Text
            font={16}
            fontWeight="bold"
            modifiers={modifiers().foregroundStyle(lab(colorScheme))}
          >
            文字位置
          </Text>
          <Spacer />
          <Picker
            label={
              <HStack spacing={4}>
                <Text
                  font={15}
                  modifiers={modifiers().foregroundStyle("#3b82f6")}
                >
                  {settings.textPosition === "top" ? "上方" : "下方"}
                </Text>
                <Image
                  systemName="chevron.down"
                  renderingMode="template"
                  modifiers={modifiers().font(12).foregroundStyle("#8e8e93")}
                />
              </HStack>
            }
            value={settings.textPosition}
            onChanged={(v: string) =>
              onChange({ textPosition: v as "top" | "bottom" })
            }
            pickerStyle="menu"
          >
            <Text tag="top">上方</Text>
            <Text tag="bottom">下方</Text>
          </Picker>
        </HStack>

        {/* 数值调节：右侧滑杆 */}
        <SliderRow
          title="文字大小"
          value={settings.textSize}
          min={10}
          max={24}
          onValue={(v) => onChange({ textSize: v })}
          cs={colorScheme}
        />

        <SliderRow
          title="条码高度"
          value={settings.barHeight}
          min={40}
          max={200}
          onValue={(v) => onChange({ barHeight: v })}
          cs={colorScheme}
        />

        <SliderRow
          title="条码宽度"
          value={settings.barWidth}
          min={1}
          max={5}
          step={0.5}
          onValue={(v) => onChange({ barWidth: v })}
          cs={colorScheme}
        />

        <SliderRow
          title="边距"
          value={settings.margin}
          min={0}
          max={40}
          onValue={(v) => onChange({ margin: v })}
          cs={colorScheme}
        />

        {/* 关于 */}
        <HStack alignment="center" spacing={10} modifiers={cardMods()}>
          <Text
            font={16}
            fontWeight="bold"
            modifiers={modifiers().foregroundStyle(lab(colorScheme))}
          >
            关于
          </Text>
          <Spacer />
          <Text
            font={14}
            modifiers={modifiers().foregroundStyle("#8e8e93")}
          >
            Design by Alan
          </Text>
        </HStack>
      </VStack>
    </ScrollView>
    </FullScreenBg>
  )
}

// 新页面：展示生成的条形码（普通页面跳转，非弹出页）
function BarcodesPage({
  items,
  settings,
  favorites,
  onClose,
  onFavorite,
}: {
  items: BarcodeItem[]
  settings: StyleSettings
  favorites: FavoriteItem[]
  onClose: () => void
  onFavorite: (name: string, folder: string) => void
}) {
  const colorScheme = settings.colorScheme
  const [isSaving, setIsSaving] = useState(false)
  // 记录刚被点击的返回键，用于“点击变浅紫”效果
  const [pressedKey, setPressedKey] = useState<string | null>(null)

  // 当前这组内容是否已在收藏中（按「内容连接串」判断，与 addFavorite 的去重键一致）
  const favKey = items.map((i) => i.text).join("\u0001")
  const isFavorited = favorites.some(
    (f) => f.texts.join("\u0001") === favKey
  )

  function flashPressed(key: string) {
    setPressedKey(key)
    setTimeout(() => setPressedKey(null), 300)
  }

  // 判断条码是否生成成功（一维看 bits，二维码看 qrImage）
  function itemOk(item: BarcodeItem): boolean {
    return item.type === "qr" ? item.qrImage != null : item.bits !== null
  }

  // 渲染单个条码主体：二维码用原生图片（qrSize 指定时按该尺寸居中缩放显示，否则用原始分辨率），一维用 Canvas
  function renderItemContent(item: BarcodeItem, qrSize?: number) {
    if (item.type === "qr") {
      if (item.qrImage == null) {
        return (
          <Text modifiers={modifiers().foregroundStyle("red")}>
            二维码生成失败
          </Text>
        )
      }
      const m =
        qrSize != null
          ? modifiers()
              .frame({ width: qrSize, height: qrSize, alignment: 'center' })
              .aspectRatio({ value: 1, contentMode: "fit" })
          : modifiers()
      return <Image image={item.qrImage} resizable={true} modifiers={m} />
    }
    if (item.bits === null) {
      return (
        <Text modifiers={modifiers().foregroundStyle("red")}>
          包含不支持字符，无法生成
        </Text>
      )
    }
    return (
      <BarcodeCanvas
        bits={item.bits}
        barW={settings.barWidth}
        barH={settings.barHeight}
        quiet={settings.margin}
        barColor={settings.barColor}
        bgColor={settings.bgColor}
      />
    )
  }

  // 按设置渲染条码下方的内容文字（显示开关 + 位置 + 大小）
  // textColor：不传则用主题主文字色 lab(colorScheme)（用于条码页「主题背景」）；传值则固定用该色（用于分享图「白底」需固定深色）。
  function renderText(item: BarcodeItem, textColor?: any) {
    if (!settings.showText || !itemOk(item)) return null
    return (
      <Text
        font={settings.textSize}
        modifiers={modifiers().foregroundStyle(textColor ?? lab(colorScheme))}
      >
        {item.text}
      </Text>
    )
  }

  // 收藏这组条形码：弹窗让用户自定义总名称；随后选择分类（可选已有分类，或新增分类/不分类），确认后回调保存
  async function favorite() {
    const texts = items.map((i) => i.text)
    // 总名称必填：留空则重新提示用户输入，直到输入非空或取消
    let trimmed: string
    while (true) {
      const name = await Dialog.prompt({
        title: "收藏这组条形码",
        message: "自定义总名称",
        defaultValue: "",
        placeholder: "请输入名称",
        confirmLabel: "下一步",
        cancelLabel: "取消",
      })
      if (name === null) return // 取消收藏
      trimmed = name.trim()
      if (trimmed.length === 0) {
        alert("名称不能为空，请重新输入")
        continue
      }
      break
    }
    // 收集现有分类（去重、按名称排序）
    const folderChoices = Array.from(
      new Set(favorites.map((f) => f.folder).filter((f) => f.length > 0))
    ).sort((a, b) => a.localeCompare(b))
    const addLabel = "＋ 新增分类"
    let folder: string
    // 循环直到拿到有效分类：选已有分类 / 不分类 / 新增（新增可取消回到选择）
    while (true) {
      const index = await Dialog.actionSheet({
        title: "选择分类",
        message: "选择已有分类，或新增分类；选择「不分类」则放入未分类",
        cancelButton: true,
        actions: [
          { label: "不分类" },
          ...folderChoices.map((f) => ({ label: f })),
          { label: addLabel },
        ],
      })
      if (index === null) return // 取消收藏
      if (index === 0) {
        folder = "" // 不分类
        break
      }
      if (index < 1 + folderChoices.length) {
        folder = folderChoices[index - 1]
        break
      }
      // 新增分类
      const nf = await Dialog.prompt({
        title: "新增分类",
        message: "输入新分类名称",
        defaultValue: "",
        placeholder: "例如：工作 / 个人",
        confirmLabel: "收藏",
        cancelLabel: "取消",
      })
      if (nf === null) continue // 取消新增 → 回到分类选择
      const nft = nf.trim()
      if (nft.length === 0) {
        alert("分类名称不能为空")
        continue
      }
      folder = nft
      break
    }
    onFavorite(trimmed, folder)
    flashPressed("fav")
    alert("已收藏")
  }

  async function shareImage() {
    if (isSaving) return
    setIsSaving(true)
    try {
      // 把条形码整体渲染成一张图片（白底、居中、条码间距 1cm）
      const element = (
        <VStack
          alignment="center"
          spacing={BARCODE_GAP}
          modifiers={modifiers()
            .padding(20)
            .background("white")}
        >
          {items.map((item) => (
            <VStack alignment="center" spacing={6}>
              {settings.textPosition === "top" && renderText(item, "#111111")}
              {renderItemContent(item)}
              {settings.textPosition === "bottom" && renderText(item, "#111111")}
              {itemOk(item) && settings.showFormat && (
                <Text font={12} modifiers={modifiers().foregroundStyle("#8e8e93")}>
                  {typeName(item.type)}
                </Text>
              )}
            </VStack>
          ))}
        </VStack>
      )
      const data = await ImageRenderer.toPNGData(element)
      const image = UIImage.fromData(data)
      if (image === null) {
        alert("生成分享图片失败")
        return
      }
      // 系统分享面板：可选择「存储图像」或「存储到文件」（存储到文件时可自定义文件名）
      await ShareSheet.present([image])
    } catch (e) {
      alert("分享失败：" + String(e))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <FullScreenBg cs={colorScheme}>
    <ScrollView
      {...schemeProps(colorScheme)} modifiers={modifiers()
        .frame({ maxWidth: 'infinity', maxHeight: 'infinity' })
        .navigationBarVisibility("hidden")
        .safeAreaInset({
          top: {
            alignment: 'leading',
            spacing: 0,
            content: (
              <HStack
                modifiers={modifiers()
                  .frame({ maxWidth: 'infinity' })
                  .padding({ top: 14.175, leading: 14.175, trailing: 14.175 })}
              >
                <Button
                  action={() => {
                    flashPressed("back")
                    onClose()
                  }}
                  modifiers={modifiers()
                    .frame({ width: 62, height: 62, alignment: 'center' })
                    .padding(0)
                    .font(26)
                    .fontWeight("bold")
                    .foregroundStyle(
                      pressedKey === "back" ? lab(colorScheme) : sub(colorScheme)
                    )
                    .contentShape({ type: "rect", cornerRadius: 16 })}
                >
                  <Image systemName="chevron.left" renderingMode="template" />
                </Button>
                <Spacer />
                <Button
                  action={() => {
                    flashPressed("fav")
                    favorite()
                  }}
                  modifiers={modifiers()
                    .frame({ width: 62, height: 62, alignment: 'center' })
                    .padding(0)
                    .font(26)
                    .fontWeight("bold")
                    .foregroundStyle(pressedKey === "fav" ? "#D97706" : "#F59E0B")
                    .padding({ trailing: 4.25 })
                    .contentShape({ type: "rect", cornerRadius: 16 })}
                >
                  <Image
                    systemName={isFavorited ? "star.fill" : "star"}
                    renderingMode="template"
                  />
                </Button>
                <Button
                  action={() => {
                    flashPressed("share")
                    shareImage()
                  }}
                  modifiers={modifiers()
                    .frame({ width: 62, height: 62, alignment: 'center' })
                    .padding(0)
                    .font(26)
                    .fontWeight("bold")
                    .foregroundStyle(
                      pressedKey === "share" ? "#1e40af" : "#3b82f6"
                    )
                    .contentShape({ type: "rect", cornerRadius: 16 })}
                >
                  <Image systemName="square.and.arrow.up" renderingMode="template" />
                </Button>
              </HStack>
            ),
          },
        })}
    >
        <VStack
          alignment="center"
          spacing={16}
          padding={16}
        >
          <VStack
            alignment="center"
            spacing={BARCODE_GAP}
            modifiers={modifiers().frame({ maxWidth: 'infinity' })}
          >
            {items.map((item) => (
              <VStack alignment="center" spacing={6}>
                {settings.textPosition === "top" && renderText(item)}
                {renderItemContent(item, Math.min(Device.screen.width - 40, 300))}
                {settings.textPosition === "bottom" && renderText(item)}
                {itemOk(item) && settings.showFormat && (
                  <Text
                    font={12}
                    modifiers={modifiers().foregroundStyle(sub(colorScheme))}
                  >
                    {typeName(item.type)}
                  </Text>
                )}
              </VStack>
            ))}
          </VStack>
        </VStack>
    </ScrollView>
    </FullScreenBg>
  )
}

// 历史时间格式化：今天显示 HH:mm，否则 MM/DD HH:mm（模块级，供 HistoryPage 使用）
function formatHistoryTime(time: number): string {
  const d = new Date(time)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return hm
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

// 以完整页面呈现条码页：用 Navigation.useDismiss 提供返回键（返回后停留原历史/收藏页）。
// 因导航栈内从子页 push 在真机无效、根级 destination 互斥，用 Navigation.present 呈现为独立新页面最可靠。
function PresentedBarcodes({
  items,
  settings,
  favorites,
  onFavorite,
}: {
  items: BarcodeItem[]
  settings: StyleSettings
  favorites: FavoriteItem[]
  onFavorite: (name: string, folder: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  return (
    <BarcodesPage
      items={items}
      settings={settings}
      favorites={favorites}
      onClose={dismiss}
      onFavorite={onFavorite}
    />
  )
}

// 历史记录页：展示最近生成列表，点击条目进入条码页查看
function HistoryPage({
  history,
  colorScheme,
  settings,
  favorites,
  barcodeType,
  buildItems,
  onFavorite,
  onClose,
  onClear,
}: {
  history: HistoryItem[]
  colorScheme: "system" | "light" | "dark"
  settings: StyleSettings
  favorites: FavoriteItem[]
  barcodeType: BarcodeType
  buildItems: (texts: string[], type: BarcodeType) => Promise<BarcodeItem[]>
  onFavorite: (name: string, folder: string) => void
  onClose: () => void
  onClear: () => void
}) {
  // 点击历史条目：以新页面呈现条码页（不在历史页内替换），返回键直接退回历史列表
  async function selectHistory(item: HistoryItem) {
    const barcodeItems = await buildItems(item.texts, barcodeType)
    await Navigation.present({
      element: (
        <PresentedBarcodes
          items={barcodeItems}
          settings={settings}
          favorites={favorites}
          onFavorite={onFavorite}
        />
      ),
      modalPresentationStyle: "fullScreen",
    })
  }

  return (
    <FullScreenBg cs={colorScheme}>
    <ScrollView
      {...schemeProps(colorScheme)} modifiers={modifiers()
        .frame({ maxWidth: 'infinity', maxHeight: 'infinity' })
        .navigationBarVisibility("hidden")
        .safeAreaInset({
          top: {
            alignment: 'leading',
            spacing: 0,
            content: (
              <HStack
                modifiers={modifiers()
                  .frame({ maxWidth: 'infinity' })
                  .padding({ top: 14.175, leading: 14.175, trailing: 14.175 })}
              >
                <Button
                  action={onClose}
                  modifiers={modifiers()
                    .frame({ width: 52, height: 52, alignment: 'center' })
                    .padding(0)
                    .font(22)
                    .fontWeight("bold")
                    .foregroundStyle("#3b82f6")
                    .contentShape({ type: "rect", cornerRadius: 16 })}
                >
                  <Image systemName="chevron.left" renderingMode="template" />
                </Button>
                <Text
                  font={20}
                  fontWeight="bold"
                  modifiers={modifiers().foregroundStyle(lab(colorScheme))}
                >
                  历史记录
                </Text>
                <Spacer />
                {history.length > 0 && (
                  <Button
                    title="清空"
                    action={onClear}
                    modifiers={modifiers()
                      .font(14)
                      .foregroundStyle("#FF3B30")
                      .padding({ leading: 10, trailing: 10, top: 4, bottom: 4 })
                      .background({
                        style: "rgba(128, 128, 128, 0.25)",
                        shape: { type: "rect", cornerRadius: 8 },
                      })}
                  />
                )}
              </HStack>
            ),
          },
        })}
    >
      <VStack alignment="center" spacing={12} padding={16}>
        {history.length === 0 ? (
          <Text
            font={16}
            modifiers={modifiers()
              .foregroundStyle("#8e8e93")
              .padding({ top: 60 })}
          >
            暂无最近生成
          </Text>
        ) : (
          history.map((item) => (
            <Button
              key={item.id}
              action={() => selectHistory(item)}
              modifiers={modifiers()
                .frame({ maxWidth: 'infinity' })
                .padding(10)
                .background({
                  style: cardB(colorScheme),
                  shape: { type: "rect", cornerRadius: 16 },
                })}
            >
              <HStack alignment="center" spacing={8}>
                <Text
                  font={15}
                  modifiers={modifiers().lineLimit(1).foregroundStyle(lab(colorScheme))}
                >
                  {item.texts.length === 1
                    ? item.texts[0]
                    : `${item.texts.length} 条：${item.texts.join("、")}`}
                </Text>
                <Spacer />
                <Text
                  font={12}
                  modifiers={modifiers().foregroundStyle("#8e8e93")}
                >
                  {formatHistoryTime(item.time)}
                </Text>
              </HStack>
            </Button>
          ))
        )}
      </VStack>
    </ScrollView>
    </FullScreenBg>
  )
}

// 收藏页：底部「收藏」Tab 打开，展示收藏列表（搜索 + 文件夹分组）；点击名称进入条码页，右侧垃圾桶删除
function FavoritesPage({
  favorites,
  colorScheme,
  settings,
  barcodeType,
  buildItems,
  onFavorite,
  onClose,
  onRemove,
  onRenameFolder,
}: {
  favorites: FavoriteItem[]
  colorScheme: "system" | "light" | "dark"
  settings: StyleSettings
  barcodeType: BarcodeType
  buildItems: (texts: string[], type: BarcodeType) => Promise<BarcodeItem[]>
  onFavorite: (name: string, folder: string) => void
  onClose: () => void
  onRemove: (id: string) => void
  onRenameFolder: (oldFolder: string, newFolder: string) => void
}) {
  // 收藏搜索关键字（空表示不筛选）；页面级状态，关闭时重置
  const [favoriteQuery, setFavoriteQuery] = useState("")
  // 已收起的收藏文件夹（Set 记录 folder 名，空字符串=未分类；默认全部展开）
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set()
  )
  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }
  // 重命名分类：弹窗输入新分类名；未分类("")重命名会把未分类收藏归入该分类
  async function editFolder(folder: string) {
    const isUncat = folder === ""
    const newName = await Dialog.prompt({
      title: "重命名分类",
      message: isUncat
        ? "把「未分类」的收藏归入新分类"
        : `将分类「${folder}」重命名为`,
      defaultValue: isUncat ? "" : folder,
      placeholder: "新分类名称",
      confirmLabel: "保存",
      cancelLabel: "取消",
    })
    if (newName === null) return
    const trimmed = newName.trim()
    if (trimmed.length === 0) {
      alert("分类名称不能为空")
      return
    }
    if (!isUncat && trimmed === folder) return // 名称未变化
    onRenameFolder(folder, trimmed)
  }
  // 按搜索关键字过滤收藏：名称/文件夹/内容任一匹配即可（大小写不敏感）
  const filteredFavorites = favoriteQuery.trim().length === 0
    ? favorites
    : favorites.filter((f) => {
        const q = favoriteQuery.trim().toLowerCase()
        return (
          f.name.toLowerCase().includes(q) ||
          (f.folder || "").toLowerCase().includes(q) ||
          f.texts.some((t) => t.toLowerCase().includes(q))
        )
      })

  // 点击收藏：以新页面呈现条码页（不在收藏页内替换），返回键直接退回收藏列表
  async function selectFavorite(fav: FavoriteItem) {
    const barcodeItems = await buildItems(fav.texts, barcodeType)
    await Navigation.present({
      element: (
        <PresentedBarcodes
          items={barcodeItems}
          settings={settings}
          favorites={favorites}
          onFavorite={onFavorite}
        />
      ),
      modalPresentationStyle: "fullScreen",
    })
  }

  return (
    <FullScreenBg cs={colorScheme}>
    <ScrollView
      {...schemeProps(colorScheme)} modifiers={modifiers()
        .frame({ maxWidth: 'infinity', maxHeight: 'infinity' })
        .navigationBarVisibility("hidden")
        .safeAreaInset({
          top: {
            alignment: 'leading',
            spacing: 0,
            content: (
              <HStack
                modifiers={modifiers()
                  .frame({ maxWidth: 'infinity' })
                  .padding({ top: 14.175, leading: 14.175, trailing: 14.175 })}
              >
                <Button
                  action={onClose}
                  modifiers={modifiers()
                    .frame({ width: 52, height: 52, alignment: 'center' })
                    .padding(0)
                    .font(22)
                    .fontWeight("bold")
                    .foregroundStyle("#3b82f6")
                    .contentShape({ type: "rect", cornerRadius: 16 })}
                >
                  <Image systemName="chevron.left" renderingMode="template" />
                </Button>
                <Text
                  font={20}
                  fontWeight="bold"
                  modifiers={modifiers().foregroundStyle(lab(colorScheme))}
                >
                  收藏
                </Text>
                <Spacer />
              </HStack>
            ),
          },
        })}
    >
      <VStack alignment="center" spacing={12} padding={16}>
        {favorites.length === 0 ? (
          <Text
            font={16}
            modifiers={modifiers()
              .foregroundStyle("#8e8e93")
              .padding({ top: 60 })}
          >
            暂无收藏
          </Text>
        ) : (
          <>
            {/* 收藏搜索框：按名称/文件夹/内容过滤 */}
            <HStack
              alignment="center"
              spacing={8}
              modifiers={modifiers()
                .frame({ maxWidth: 'infinity' })
                .padding(10)
                .background({
                  style: cardB(colorScheme),
                  shape: { type: "rect", cornerRadius: 16 },
                })}
            >
              <Image
                systemName="magnifyingglass"
                renderingMode="template"
                modifiers={modifiers().foregroundStyle(sub(colorScheme))}
              />
              <TextField
                title="搜索收藏"
                prompt="搜索名称、文件夹或内容"
                value={favoriteQuery}
                onChanged={setFavoriteQuery}
                submitLabel="search"
                onSubmit={() => Keyboard.hide()}
                modifiers={modifiers()
                  .frame({ maxWidth: 'infinity' })
                  .font(16)
                  .foregroundStyle(inputT(colorScheme))
                  .padding(4)}
              />
              {favoriteQuery.length > 0 && (
                <Button
                  title="✕"
                  action={() => setFavoriteQuery("")}
                  modifiers={modifiers()
                    .frame({ width: 28, height: 28, alignment: 'center' })
                    .padding(0)
                    .font(14)
                    .foregroundStyle("#8e8e93")
                    .background({
                      style: "rgba(128, 128, 128, 0.25)",
                      shape: "circle",
                    })}
                />
              )}
            </HStack>
            {filteredFavorites.length === 0 ? (
              <Text
                font={14}
                modifiers={modifiers().foregroundStyle("#8e8e93")}
              >
                没有匹配的收藏
              </Text>
            ) : (
              Array.from(
                new Set(filteredFavorites.map((f) => f.folder || ""))
              ).map((folder) => {
                const groupItems = filteredFavorites.filter(
                  (f) => (f.folder || "") === folder
                )
                return (
                  <VStack
                    key={folder === "" ? "__uncategorized" : folder}
                    alignment="center"
                    spacing={8}
                  >
                    <HStack
                      alignment="center"
                      spacing={6}
                      modifiers={modifiers()
                        .frame({ maxWidth: 'infinity' })
                        .padding(2)}
                    >
                      <Button
                        action={() => toggleFolder(folder)}
                        modifiers={modifiers().frame({ maxWidth: 'infinity' })}
                      >
                        <HStack alignment="center" spacing={6}>
                          <Image
                            systemName={
                              folder === "" ? "folder" : "folder.fill"
                            }
                            renderingMode="template"
                            modifiers={modifiers().foregroundStyle(sub(colorScheme))}
                          />
                          <Text
                            font={14}
                            fontWeight="bold"
                            modifiers={modifiers().foregroundStyle("#3b82f6")}
                          >
                            {folder === "" ? "未分类" : folder}
                          </Text>
                          <Spacer />
                          <Text
                            font={12}
                            modifiers={modifiers().foregroundStyle("#8e8e93")}
                          >
                            {groupItems.length} 个
                          </Text>
                          <Image
                            systemName={
                              collapsedFolders.has(folder)
                                ? "chevron.right"
                                : "chevron.down"
                            }
                            renderingMode="template"
                            modifiers={modifiers().font(20).foregroundStyle(sub(colorScheme))}
                          />
                        </HStack>
                      </Button>
                      <Button
                        action={() => editFolder(folder)}
                        modifiers={modifiers()
                          .frame({ width: 44, height: 44, alignment: 'center' })
                          .padding(0)
                          .font(20)
                          .foregroundStyle(sub(colorScheme))
                          .contentShape({ type: "rect", cornerRadius: 16 })}
                      >
                        <Image systemName="pencil" renderingMode="template" />
                      </Button>
                    </HStack>
                    {!collapsedFolders.has(folder) &&
                      groupItems.map((fav) => (
                        <HStack
                          key={fav.id}
                          alignment="center"
                          spacing={8}
                          modifiers={modifiers()
                            .frame({ maxWidth: 'infinity' })
                            .padding(10)
                            .background({
                              style: cardB(colorScheme),
                              shape: { type: "rect", cornerRadius: 16 },
                            })}
                        >
                          <Button
                            action={() => selectFavorite(fav)}
                            modifiers={modifiers().frame({
                              maxWidth: 'infinity',
                            })}
                          >
                            <Text
                              font={16}
                              fontWeight="bold"
                              modifiers={modifiers()
                                .foregroundStyle(lab(colorScheme))
                                .frame({
                                  maxWidth: 'infinity',
                                  alignment: 'leading',
                                })}
                            >
                              {fav.name}
                            </Text>
                          </Button>
                          <Button
                            action={() => onRemove(fav.id)}
                            modifiers={modifiers()
                              .frame({ width: 32, height: 32, alignment: 'center' })
                              .padding(0)
                              .font(14)
                              .foregroundStyle("#FF3B30")
                              .background({
                                style: "rgba(128, 128, 128, 0.25)",
                                shape: "circle",
                              })}
                          >
                            <Image systemName="trash" renderingMode="template" />
                          </Button>
                        </HStack>
                      ))}
                  </VStack>
                )
              })
            )}
          </>
        )}
      </VStack>
    </ScrollView>
    </FullScreenBg>
  )
}

function View() {
  // 单个多行输入框内容（扫描表格后自动换行）
  const [input, setInput] = useState("")
  // 勾选「每行生成一个条码」：输入框内每行各生成一个；不勾选则整段作为一个条码
  const [perLine, setPerLine] = useState(false)
  const [items, setItems] = useState<BarcodeItem[]>([])
  const [showBarcodes, setShowBarcodes] = useState(false)
  // 关闭整个应用（全屏呈现的主页面，dismiss 后脚本退出）
  const dismiss = Navigation.useDismiss()
  // 记录刚被点击的功能键，用于“点击变浅蓝”效果
  const [pressedKey, setPressedKey] = useState<string | null>(null)
  // 滚动控制：添加输入后自动滚到新行
  const scrollProxyRef = useRef<ScrollViewProxy>()
  // 最近生成历史（从持久化读取）
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  // 收藏（从持久化读取）
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites())
  // 当前选择的条码类型（默认 Code 128-B）
  const [barcodeType, setBarcodeType] = useState<BarcodeType>("code128")
  // 样式设置（从持久化读取）
  const [settings, setSettings] = useState<StyleSettings>(() => loadSettings())
  // 外观设置（跟随系统/浅色/深色）——作为各取色函数的参数
  const colorScheme = settings.colorScheme
  // 键盘是否可见（用于在输入框右上角显示「完成」按钮收起键盘）
  const keyboardVisible = useKeyboardVisible()
  // 是否打开样式设置页
  const [showSettings, setShowSettings] = useState(false)
  // 是否打开历史记录页
  const [showHistory, setShowHistory] = useState(false)
  // 是否打开收藏页
  const [showFavorites, setShowFavorites] = useState(false)
  // 用于可靠激活输入：点击输入框时自增，触发输入框 remount+autofocus 唤出键盘
  const [inputFocusTick, setInputFocusTick] = useState(0)

  // 点击时短暂显示浅蓝色，随后恢复灰色玻璃
  function flashPressed(key: string) {
    setPressedKey(key)
    setTimeout(() => setPressedKey(null), 300)
  }

  // 相机扫描（表格识别）：识别出的每行用换行合并进单输入框（自动换行），追加到已有内容
  async function scanInput() {
    const texts = await scanTexts()
    if (texts === null) return
    const joined = texts.join("\n")
    setInput((prev) => (prev.length > 0 ? prev + "\n" + joined : joined))
  }

  // 生成条码内容：QR 用原生 API 生成图片，其余一维条码用位模式编码
  async function buildItems(texts: string[], type: BarcodeType): Promise<BarcodeItem[]> {
    if (type === "qr") {
      const list: BarcodeItem[] = []
      for (const text of texts) {
        let img: UIImage | null = null
        try {
          img = await QRCode.generate(text)
        } catch {
          img = null
        }
        list.push({ text, bits: null, type, qrImage: img })
      }
      return list
    }
    return texts.map((text) => ({ text, bits: encodeBarcode(type, text), type }))
  }

  // 收集输入内容：勾选「每行生成一个条码」则按换行拆成多条；否则整段作为一个条码。为空时提示并返回 null
  function collectTexts(): string[] | null {
    const raw = input.trim()
    if (raw.length === 0) {
      alert("请输入内容")
      return null
    }
    if (perLine) {
      const texts = raw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0)
      if (texts.length === 0) {
        alert("请输入内容")
        return null
      }
      return texts
    }
    return [raw]
  }

  // 按指定格式生成并跳转（同时记录最近生成历史：同内容去重置顶，最多保留 HISTORY_MAX 条）
  async function doGenerate(texts: string[], type: BarcodeType) {
    setBarcodeType(type)
    setItems(await buildItems(texts, type))
    const key = texts.join("\u0001")
    const next = [
      { id: makeRowId(), texts, time: Date.now() },
      ...history.filter((h) => h.texts.join("\u0001") !== key),
    ].slice(0, HISTORY_MAX)
    setHistory(next)
    saveHistory(next)
    // 跳转到新页面展示条形码（普通页面跳转）
    setShowBarcodes(true)
  }

  // 单击生成条码：默认 Code 128 直接生成
  async function generate() {
    const texts = collectTexts()
    if (texts === null) return
    await doGenerate(texts, "code128")
  }

  // 长按生成条码：弹出选项选择其他格式
  async function generateWithPicker() {
    const texts = collectTexts()
    if (texts === null) return
    const index = await Dialog.actionSheet({
      title: "选择条码格式",
      message: texts.length === 1 ? texts[0] : `共 ${texts.length} 条内容`,
      cancelButton: true,
      actions: BARCODE_TYPES.map((t) => ({ label: t.name })),
    })
    if (index === null) return
    await doGenerate(texts, BARCODE_TYPES[index].id)
  }


  // 清空最近生成历史
  function clearHistory() {
    setHistory([])
    Storage.remove(HISTORY_KEY)
  }

  // 更新样式设置并持久化
  function updateSettings(patch: Partial<StyleSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  // 收藏当前生成内容（总名称与文件夹由用户在弹窗自定义；不限数量，同内容去重置顶）
  function addFavorite(name: string, folder: string) {
    const texts = items.map((i) => i.text)
    const key = texts.join("\u0001")
    const next = [
      { id: makeRowId(), name, texts, time: Date.now(), folder },
      ...favorites.filter((f) => f.texts.join("\u0001") !== key),
    ]
    setFavorites(next)
    saveFavorites(next)
  }

  // 删除收藏
  function removeFavorite(id: string) {
    const next = favorites.filter((f) => f.id !== id)
    setFavorites(next)
    saveFavorites(next)
  }

  // 重命名分类：把该分类下所有收藏移动到新分类名（未分类 "" 也一并归类）
  function renameFolder(oldFolder: string, newFolder: string) {
    const next = favorites.map((f) =>
      f.folder === oldFolder ? { ...f, folder: newFolder } : f
    )
    setFavorites(next)
    saveFavorites(next)
  }


  return (
    <NavigationStack>
      <ScrollViewReader>
        {(proxy) => {
          scrollProxyRef.current = proxy
          // 根视图修饰符：4 个导航目标（外观覆盖在 ScrollView 元素上用 schemeProps 属性传入）
          let rootMods = modifiers()
            .navigationDestination({
              isPresented: showBarcodes,
              onChanged: setShowBarcodes,
              content: (
                <BarcodesPage
                  items={items}
                  settings={settings}
                  favorites={favorites}
                  onClose={() => setShowBarcodes(false)}
                  onFavorite={addFavorite}
                />
              ),
            })
            .navigationDestination({
              isPresented: showSettings,
              onChanged: setShowSettings,
              content: (
                <SettingsPage
                  settings={settings}
                  onChange={updateSettings}
                  onClose={() => setShowSettings(false)}
                />
              ),
            })
            .navigationDestination({
              isPresented: showHistory,
              onChanged: setShowHistory,
              content: (
                <HistoryPage
                  history={history}
                  colorScheme={settings.colorScheme}
                  settings={settings}
                  favorites={favorites}
                  barcodeType={barcodeType}
                  buildItems={buildItems}
                  onFavorite={addFavorite}
                  onClose={() => setShowHistory(false)}
                  onClear={clearHistory}
                />
              ),
            })
            .navigationDestination({
              isPresented: showFavorites,
              onChanged: setShowFavorites,
              content: (
                <FavoritesPage
                  favorites={favorites}
                  colorScheme={settings.colorScheme}
                  settings={settings}
                  barcodeType={barcodeType}
                  buildItems={buildItems}
                  onFavorite={addFavorite}
                  onClose={() => setShowFavorites(false)}
                  onRemove={removeFavorite}
                  onRenameFolder={renameFolder}
                />
              ),
            })
          rootMods = rootMods
            .frame({ maxWidth: 'infinity', maxHeight: 'infinity' })
            .safeAreaInset({
            top: {
              alignment: 'leading',
              spacing: 0,
              content: (
                <HStack
                  spacing={8}
                  modifiers={modifiers()
                    .frame({ maxWidth: 'infinity' })
                    .padding({ top: 14, leading: 14.175, trailing: 14.175 })}
                >
                  <Button
                    action={() => {
                      flashPressed("settings")
                      setShowSettings(true)
                    }}
                    modifiers={modifiers()
                      .frame({ width: 62, height: 62, alignment: 'center' })
                      .padding(0)
                      .font(26)
                      .fontWeight("bold")
                      .foregroundStyle(
                        pressedKey === "settings" ? lab(colorScheme) : sub(colorScheme)
                      )
                      .contentShape({ type: "rect", cornerRadius: 16 })}
                  >
                    <Image systemName="gearshape" renderingMode="template" />
                  </Button>
                  <Spacer />
                  <Button
                    action={() => {
                      flashPressed("close")
                      dismiss()
                    }}
                    modifiers={modifiers()
                      .frame({ width: 62, height: 62, alignment: 'center' })
                      .padding(0)
                      .font(26)
                      .fontWeight("bold")
                      .foregroundStyle(
                        pressedKey === "close" ? lab(colorScheme) : sub(colorScheme)
                      )
                      .contentShape({ type: "rect", cornerRadius: 16 })}
                  >
                    <Image systemName="xmark" renderingMode="template" />
                  </Button>
                </HStack>
              ),
            },
          })
          // 输入框背后的卡片视觉（仅供背景/边框，不接收手势；手势在顶层捕获层）。
          // 本框架下「高的多行 TextField」的点击聚焦不可靠，所以用 ZStack 分三层：
          //   下层 卡片视觉(本 inputCardModifiers + VStack)
          //   中层 文本框(inputTextModifiers，固定高度，超长内容在框内滚动)
          //   顶层 透明点击捕获层(inputCatcherModifiers)：点输入框任意处(留白/文字区)
          //        → inputFocusTick 自增 → 文本框 remount+autofocus 真正唤出键盘。
          let inputCardModifiers = modifiers()
            .frame({ maxWidth: 'infinity', minHeight: 152, maxHeight: 152, alignment: 'topLeading' })
            .padding(10)
            .background({
              style: capB(colorScheme),
              shape: { type: "rect", cornerRadius: 12 },
            })
            .overlay({
              alignment: "center",
              content: (
                <RoundedRectangle
                  cornerRadius={12}
                  stroke={{
                    shapeStyle: "rgba(128, 128, 128, 0.35)",
                    strokeStyle: { lineWidth: 1 },
                  }}
                />
              ),
            })
          // 文本框修饰符：固定高度(不随内容延伸，超长内容在框内滚动)，无背景。
          // 背景由下层卡片提供，二者均带 padding(10) 使文字与卡片内容区对齐。
          let inputTextModifiers = modifiers()
            .frame({ maxWidth: 'infinity', minHeight: 152, maxHeight: 152, alignment: 'topLeading' })
            .font(20)
            .foregroundStyle(inputT(colorScheme))
            .padding(10)
          // 点击捕获层(最上层，透明)：本框架下"高的多行 TextField"的点击聚焦不可靠，
          // 改为"点输入框任意处 → inputFocusTick 自增 → 文本框 remount+autofocus 真正唤出键盘"。
          // 用 ZStack 把它放在文本框之后(最顶)，保证任意点击都命中它(留白/文字区皆可)。
          let inputCatcherModifiers = modifiers()
            .frame({ maxWidth: 'infinity', minHeight: 152, maxHeight: 152, alignment: 'topLeading' })
            .contentShape({ type: "rect", cornerRadius: 12 })
            .onTapGesture(() => setInputFocusTick((k) => k + 1))
          // 键盘可见时在捕获层右上角(最顶)叠加「完成」按钮收起键盘(顶层，不被捕获层拦截)。
          if (keyboardVisible) {
            inputCatcherModifiers = inputCatcherModifiers.overlay({
              alignment: "topTrailing",
              content: (
                <Button
                  title="完成"
                  action={() => Keyboard.hide()}
                  modifiers={modifiers()
                    .fontWeight("bold")
                    .foregroundStyle(lab(colorScheme))
                    .padding({ top: 8, leading: 16, trailing: 16, bottom: 8 })
                    .background({
                      style: cardB(colorScheme),
                      shape: { type: "rect", cornerRadius: 10 },
                    })
                    .contentShape({ type: "rect", cornerRadius: 10 })}
                />
              ),
            })
          }
          return (
            // 注意：首页 ScrollView 拥有全部导航目标（rootMods 里的 navigationDestination）。
            // 不能把 preferredColorScheme 加在这里——运行中切换外观会改变这个「导航宿主」视图的
            // preferredColorScheme，导致框架重置导航栈、把已 push 的设置页弹回首页。
            // 因此各导航页面（设置/条码/历史/收藏）在自己的根 ScrollView 上分别应用 schemeProps。
            <FullScreenBg cs={colorScheme}>
              <VStack
                spacing={0}
                modifiers={modifiers()
                  .frame({ maxWidth: 'infinity', maxHeight: 'infinity' })
                  .ignoresSafeArea({ regions: 'keyboard', edges: 'bottom' })}
              >
                <ScrollView
                  scrollDismissesKeyboard="never"
                  modifiers={rootMods}
                >
        <VStack
          alignment="center"
          spacing={16}
          padding={{ top: 48.35, leading: 20, bottom: 20, trailing: 20 }}
        >
          <Text
            font={26}
            fontWeight="bold"
            modifiers={modifiers().foregroundStyle(lab(colorScheme))}
          >
            条形码生成器
          </Text>
          {/* 单个多行输入框（扫描表格后自动换行） */}
          <ZStack alignment="topLeading">
            {/* 下层：卡片视觉(背景/边框，不接收手势) */}
            <VStack spacing={0} modifiers={inputCardModifiers} />
            {/* 中层：文字区本体，随内容撑高 */}
            <TextField
              key={inputFocusTick}
              autofocus={inputFocusTick > 0}
              title="输入内容"
              value={input}
              onChanged={setInput}
              prompt="每行一个，扫描表格后自动换行"
              axis="vertical"
              modifiers={inputTextModifiers}
            />
            {/* 顶层：透明点击捕获层(点任意处→remount+autofocus唤出键盘)，含「完成」按钮 */}
            <VStack spacing={0} modifiers={inputCatcherModifiers} />
          </ZStack>
          {/* 每行生成一个条码 勾选项 */}
          <HStack
            spacing={12}
            alignment="center"
            modifiers={modifiers()
              .frame({ maxWidth: 'infinity', alignment: 'leading' })
              .padding(10)}
          >
            <Button
              action={() => {
                flashPressed("perLine")
                setPerLine((p) => !p)
              }}
              modifiers={modifiers()
                .frame({ width: 52, height: 52 })
                .contentShape({ type: "rect", cornerRadius: 12 })
                .opacity(pressedKey === "perLine" ? 0.6 : 1)}
            >
              <Image
                systemName={perLine ? "checkmark.square.fill" : "square"}
                renderingMode="template"
                modifiers={modifiers()
                  .frame({ width: 46, height: 46 })
                  .foregroundStyle(perLine ? "#3b82f6" : sub(colorScheme))}
              />
            </Button>
            <Text font={17} modifiers={modifiers().foregroundStyle(lab(colorScheme))}>
              每行生成一个条码
            </Text>
            <Spacer />
          </HStack>
        </VStack>
                </ScrollView>
                <VStack
                  spacing={0}
                  modifiers={modifiers()
                    .frame({ maxWidth: 'infinity' })
                    .ignoresSafeArea({ regions: 'keyboard', edges: 'bottom' })}
                >
                  <HStack
                    spacing={10}
                    modifiers={modifiers()
                      .frame({ maxWidth: 'infinity' })
                      .padding({
                        top: 6,
                        bottom: 6,
                        leading: 16,
                        trailing: 16,
                      })}
                  >
                    <Button
                      title="扫码识别"
                      action={() => {
                        flashPressed("tab-scan")
                        scanInput()
                      }}
                      modifiers={modifiers()
                        .frame({ maxWidth: 'infinity' })
                        .padding(10)
                        .font(16)
                        .fontWeight("bold")
                        .foregroundStyle(
                          pressedKey === "tab-scan"
                            ? "#3b82f6"
                            : lab(colorScheme)
                        )
                        .background({
                          style: cardB(colorScheme),
                          shape: { type: "rect", cornerRadius: 16 },
                        })}
                    />
                    <Text
                      modifiers={modifiers()
                        .frame({ maxWidth: 'infinity' })
                        .padding(10)
                        .font(16)
                        .fontWeight("bold")
                        .foregroundStyle(
                          pressedKey === "tab-generate"
                            ? "#3b82f6"
                            : lab(colorScheme)
                        )
                        .background({
                          style: cardB(colorScheme),
                          shape: { type: "rect", cornerRadius: 16 },
                        })
                        .onTapGesture(() => {
                          flashPressed("tab-generate")
                          generate()
                        })
                        .onLongPressGesture(() => {
                          flashPressed("tab-generate")
                          generateWithPicker()
                        })}
                    >
                      批量生成
                    </Text>
                    <Button
                      title="收藏"
                      action={() => {
                        flashPressed("tab-favorites")
                        setShowFavorites(true)
                      }}
                      modifiers={modifiers()
                        .frame({ maxWidth: 'infinity' })
                        .padding(10)
                        .font(16)
                        .fontWeight("bold")
                        .foregroundStyle(
                          pressedKey === "tab-favorites"
                            ? "#3b82f6"
                            : lab(colorScheme)
                        )
                        .background({
                          style: cardB(colorScheme),
                          shape: { type: "rect", cornerRadius: 16 },
                        })}
                    />
                    <Button
                      title="历史记录"
                      action={() => {
                        flashPressed("tab-history")
                        setShowHistory(true)
                      }}
                      modifiers={modifiers()
                        .frame({ maxWidth: 'infinity' })
                        .padding(10)
                        .font(16)
                        .fontWeight("bold")
                        .foregroundStyle(
                          pressedKey === "tab-history"
                            ? "#3b82f6"
                            : lab(colorScheme)
                        )
                        .background({
                          style: cardB(colorScheme),
                          shape: { type: "rect", cornerRadius: 16 },
                        })}
                    />
                  </HStack>
                </VStack>
              </VStack>
            </FullScreenBg>
          )
        }}
      </ScrollViewReader>
    </NavigationStack>
  )
}

async function run() {
  // 全屏显示：整个应用铺满手机屏幕，而非弹出式卡片
  await Navigation.present({
    element: <View />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
