// barcode_core.tsx — 多种一维条码共享逻辑（index.tsx 使用）
import { Canvas, modifiers } from "scripting"

// 共享扫描函数：第一页扫描按钮使用。
// 相机扫描文字：打开相机取景，对准文字自动识别，返回识别出的文字数组（每项一行）；取消时返回 null。
export async function scanTexts(): Promise<string[] | null> {
  try {
    const texts = await Vision.scanDocument({
      recognitionLevel: "accurate",
      recognitionLanguages: ["en-US", "zh-Hans"],
      usesLanguageCorrection: true,
    })
    // 每个识别块内部可能含多行（如表格多行数据），按换行拆成多个输入
    const lines = texts
      .flatMap((s) => s.split(/\r?\n/))
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return lines.length > 0 ? lines : null
  } catch (e) {
    // 用户取消或识别失败，忽略
    return null
  }
}

// ============ 条码类型定义 ============
// 支持的条码类型：QR Code / Code 128-B / Code 39 / EAN-13 / UPC-A / ITF-14
export type BarcodeType = "qr" | "code128" | "code39" | "ean13" | "upca" | "itf14"

export interface BarcodeTypeInfo {
  id: BarcodeType
  name: string
  hint: string
}

// 所有可选类型（按展示顺序）
export const BARCODE_TYPES: BarcodeTypeInfo[] = [
  { id: "qr", name: "QR Code", hint: "任意文本" },
  { id: "code128", name: "Code 128-B", hint: "任意文本" },
  { id: "code39", name: "Code 39", hint: "A-Z 0-9 - . 空格 $ / + %" },
  { id: "ean13", name: "EAN-13", hint: "12~13 位数字" },
  { id: "upca", name: "UPC-A", hint: "11~12 位数字" },
  { id: "itf14", name: "ITF-14", hint: "13~14 位数字" },
]

export function typeName(type: BarcodeType): string {
  return BARCODE_TYPES.find((t) => t.id === type)?.name ?? "Code 128-B"
}

// ============ 样式设置 ============
// 条码颜色 / 背景颜色 / 显示文字 / 文字位置 / 文字大小 / 条码高度 / 条码宽度（模块宽） / 边距（静区） / 显示条码格式 / 外观（跟随系统/浅色/深色）
export interface StyleSettings {
  barColor: string
  bgColor: string
  showText: boolean
  textPosition: "top" | "bottom"
  textSize: number
  barHeight: number
  barWidth: number
  margin: number
  showFormat: boolean
  colorScheme: "system" | "light" | "dark"
}

export const DEFAULT_STYLE: StyleSettings = {
  barColor: "#000000",
  bgColor: "#ffffff",
  showText: true,
  textPosition: "bottom",
  textSize: 14,
  barHeight: 80,
  barWidth: 2,
  margin: 10,
  showFormat: true,
  colorScheme: "system",
}

// ============ Code 128-B（原有） ============

export const START_B = 104
export const STOP = 106

// 标准 Code 128 符号表（值 0-105 为 11 模块，值 106 为 13 模块停止符）
// 来源：ISO/IEC 15417 标准编码表
export const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011",
].map((s) => s.split("").map(Number))

export function charToValue(c: string): number | null {
  const code = c.charCodeAt(0)
  if (code >= 32 && code <= 126) {
    return code - 32
  }
  return null
}

export function encodeCode128B(text: string): number[] | null {
  const values = [START_B]
  let check = START_B
  for (let i = 0; i < text.length; i++) {
    const v = charToValue(text[i])
    if (v === null) return null
    values.push(v)
    check += v * (i + 1)
  }
  const checkDigit = check % 103
  values.push(checkDigit)
  values.push(STOP)
  const bits: number[] = []
  for (const v of values) {
    bits.push(...PATTERNS[v])
  }
  return bits
}

// ============ Code 39 ============
// 字符集：0-9 A-Z - . 空格 $ / + %，每个字符 9 个元素（5 条 4 空，3 宽 6 窄）
// 编码表：9 位字符串，1=宽，0=窄，元素交替条/空，以条开始
const CODE39_PATTERNS: Record<string, string> = {
  "0": "000110100", "1": "100100001", "2": "001100001", "3": "101100000",
  "4": "000110001", "5": "100110000", "6": "001110000", "7": "000100101",
  "8": "100100100", "9": "001100100", "A": "100001001", "B": "001001001",
  "C": "101001000", "D": "000011001", "E": "100011000", "F": "001011000",
  "G": "000001101", "H": "100001100", "I": "001001100", "J": "000011100",
  "K": "100000011", "L": "001000011", "M": "101000010", "N": "000010011",
  "O": "100010010", "P": "001010010", "Q": "000000111", "R": "100000110",
  "S": "001000110", "T": "000010110", "U": "110000001", "V": "011000001",
  "W": "111000000", "X": "010010001", "Y": "110010000", "Z": "011010000",
  "-": "010000101", ".": "110000100", " ": "011000100", "$": "010101000",
  "/": "010100010", "+": "010001010", "%": "000101010", "*": "010010100",
}

// 把某个 Code 39 字符的 9 元素模式展开为模块序列（宽=2 模块，窄=1 模块，交替条/空）
function code39CharModules(pattern: string): number[] {
  const modules: number[] = []
  for (let i = 0; i < 9; i++) {
    const wide = pattern[i] === "1"
    const isBar = i % 2 === 0
    const width = wide ? 2 : 1
    for (let w = 0; w < width; w++) modules.push(isBar ? 1 : 0)
  }
  return modules
}

// 编码 Code 39：起始 * + 数据（字符间加 1 模块窄间隔）+ 终止 *
export function encodeCode39(text: string): number[] | null {
  const upper = text.toUpperCase()
  for (const c of upper) {
    if (!CODE39_PATTERNS[c]) return null
  }
  const bits: number[] = []
  bits.push(...code39CharModules(CODE39_PATTERNS["*"]))
  const gap = [0]
  for (const c of upper) {
    bits.push(...gap)
    bits.push(...code39CharModules(CODE39_PATTERNS[c]))
  }
  bits.push(...gap)
  bits.push(...code39CharModules(CODE39_PATTERNS["*"]))
  return bits
}

// ============ EAN-13 / UPC-A ============
// L 码（左侧），G 码（左侧 L 的补码），R 码（右侧，L 的反码）
const EAN_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011", "0110001",
  "0101111", "0111011", "0110111", "0001011",
]
const EAN_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101", "0111001",
  "0000101", "0010001", "0001001", "0010111",
]
const EAN_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100", "1001110",
  "1010000", "1000100", "1001000", "1110100",
]
// EAN-13 第一位数字决定左侧 6 位的 L/G 组合
const EAN_FIRST = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
]

function ean13CheckDigit(d12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = Number(d12[i])
    sum += i % 2 === 0 ? d * 1 : d * 3
  }
  return (10 - (sum % 10)) % 10
}

// 编码 EAN-13：接受 12 位（自动算校验位）或 13 位（校验位重算）
export function encodeEAN13(text: string): number[] | null {
  const cleaned = text.replace(/\s/g, "")
  if (!/^\d{12,13}$/.test(cleaned)) return null
  const data = cleaned.length === 13 ? cleaned.slice(0, 12) : cleaned
  const full = data + String(ean13CheckDigit(data))
  const first = Number(full[0])
  const pattern = EAN_FIRST[first]
  const bits: number[] = []
  const push = (s: string) => {
    for (const ch of s) bits.push(ch === "1" ? 1 : 0)
  }
  push("101")
  for (let i = 1; i <= 6; i++) {
    const d = Number(full[i])
    push(pattern[i - 1] === "L" ? EAN_L[d] : EAN_G[d])
  }
  push("01010")
  for (let i = 7; i <= 12; i++) {
    push(EAN_R[Number(full[i])])
  }
  push("101")
  return bits
}

function upcaCheckDigit(d11: string): number {
  let sum = 0
  for (let i = 0; i < 11; i++) {
    const d = Number(d11[i])
    sum += i % 2 === 0 ? d * 3 : d * 1
  }
  return (10 - (sum % 10)) % 10
}

// 编码 UPC-A：接受 11 位（自动算校验位）或 12 位（校验位重算）
export function encodeUPCA(text: string): number[] | null {
  const cleaned = text.replace(/\s/g, "")
  if (!/^\d{11,12}$/.test(cleaned)) return null
  const data = cleaned.length === 12 ? cleaned.slice(0, 11) : cleaned
  const full = data + String(upcaCheckDigit(data))
  const bits: number[] = []
  const push = (s: string) => {
    for (const ch of s) bits.push(ch === "1" ? 1 : 0)
  }
  push("101")
  for (let i = 0; i < 6; i++) push(EAN_L[Number(full[i])])
  push("01010")
  for (let i = 6; i < 12; i++) push(EAN_R[Number(full[i])])
  push("101")
  return bits
}

// ============ ITF-14（交错二五码） ============
// 数字成对编码：第一个数字用条表示，第二个用空表示；宽=2 模块，窄=1 模块
const ITF_PATTERNS = [
  "00110", "10001", "01001", "11000", "00101",
  "10100", "01100", "00011", "10010", "01010",
]

function itf14CheckDigit(d13: string): number {
  let sum = 0
  for (let i = 0; i < 13; i++) {
    const d = Number(d13[i])
    sum += i % 2 === 0 ? d * 3 : d * 1
  }
  return (10 - (sum % 10)) % 10
}

// 编码 ITF-14：接受 13 位（自动算校验位）或 14 位（校验位重算）
export function encodeITF14(text: string): number[] | null {
  const cleaned = text.replace(/\s/g, "")
  if (!/^\d{13,14}$/.test(cleaned)) return null
  const data = cleaned.length === 14 ? cleaned.slice(0, 13) : cleaned
  const full = data + String(itf14CheckDigit(data))
  const bits: number[] = []
  // 起始符：窄条 窄空 窄条 窄空
  bits.push(1, 0, 1, 0)
  for (let i = 0; i < 14; i += 2) {
    const barPat = ITF_PATTERNS[Number(full[i])]
    const spacePat = ITF_PATTERNS[Number(full[i + 1])]
    for (let j = 0; j < 5; j++) {
      const barModules = barPat[j] === "1" ? 2 : 1
      for (let b = 0; b < barModules; b++) bits.push(1)
      const spaceModules = spacePat[j] === "1" ? 2 : 1
      for (let s = 0; s < spaceModules; s++) bits.push(0)
    }
  }
  // 终止符：宽条 窄空 窄条
  bits.push(1, 1, 0, 1)
  return bits
}

// 按类型编码：统一入口，返回模块序列（1=黑，0=白）或 null（内容不合法）
export function encodeBarcode(type: BarcodeType, text: string): number[] | null {
  switch (type) {
    case "qr": return null // QR 由原生 QRCode.generate 生成 UIImage，不参与位模式编码
    case "code39": return encodeCode39(text)
    case "ean13": return encodeEAN13(text)
    case "upca": return encodeUPCA(text)
    case "itf14": return encodeITF14(text)
    default: return encodeCode128B(text)
  }
}

export interface BarcodeItem {
  text: string
  bits: number[] | null
  type: BarcodeType
  // QR 码：由原生 API 生成的图片（type === "qr" 时使用，bits 为 null）
  qrImage?: UIImage | null
}

export interface BarcodeCanvasProps {
  bits: number[]
  barW?: number
  barH?: number
  quiet?: number
  maxWidth?: number
  barColor?: string
  bgColor?: string
}

export function BarcodeCanvas({
  bits,
  barW = 2,
  barH = 80,
  quiet = 10,
  maxWidth = 330,
  barColor = "#000000",
  bgColor = "#ffffff",
}: BarcodeCanvasProps) {
  // 内容过长时按比例缩小，保证条码不超出容器
  const scale = Math.min(1, maxWidth / (bits.length * barW))
  const effBarW = barW * scale
  const width = bits.length * effBarW + quiet * 2

  return (
    <Canvas
      frame={{ width, height: barH }}
      draw={(ctx) => {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, width, barH)
        ctx.fillStyle = barColor
        for (let i = 0; i < bits.length; i++) {
          if (bits[i] === 1) {
            ctx.fillRect(quiet + i * effBarW, 0, effBarW, barH)
          }
        }
      }}
    />
  )
}

