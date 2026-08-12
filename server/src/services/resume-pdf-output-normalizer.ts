type JsonObject = Record<string, unknown>

export type ResumePdfOutputNormalizationResult = {
  value: unknown
  warnings: string[]
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const languageAliases = new Map<string, string>([
  ['english', '英语'],
  ['英文', '英语'],
  ['spanish', '西班牙语'],
  ['español', '西班牙语'],
  ['西班牙文', '西班牙语'],
  ['portuguese', '葡萄牙语'],
  ['português', '葡萄牙语'],
  ['葡萄牙文', '葡萄牙语'],
  ['french', '法语'],
  ['français', '法语'],
  ['法文', '法语'],
  ['japanese', '日语'],
  ['日本語', '日语'],
  ['日文', '日语'],
  ['other', '其他'],
  ['others', '其他'],
])

function joinStringArray(value: unknown, separator = '\n') {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return value
  return value
    .map((item) => item.trim())
    .filter(Boolean)
    .join(separator)
}

function replaceNullStrings(output: JsonObject, fields: string[]) {
  let replaced = false
  for (const field of fields) {
    if (output[field] !== null) continue
    output[field] = ''
    replaced = true
  }
  return replaced
}

function normalizeArrayField(output: JsonObject, field: string, warnings: Set<string>, warning: string) {
  if (output[field] !== null) return
  output[field] = []
  warnings.add(warning)
}

function normalizePortfolioLinks(output: JsonObject, warnings: Set<string>) {
  normalizeArrayField(output, 'portfolioLinks', warnings, '作品链接为空，已按未填写处理。')
  if (!Array.isArray(output.portfolioLinks)) return

  let converted = false
  output.portfolioLinks = output.portfolioLinks.map((item) => {
    if (typeof item !== 'string') return item
    const url = item.trim()
    if (!isHttpUrl(url)) return item
    converted = true
    return { label: '作品链接', url }
  })

  if (converted) warnings.add('作品链接已从网址列表转换为链接条目，请确认名称。')
}

function normalizeLanguages(output: JsonObject, warnings: Set<string>) {
  normalizeArrayField(output, 'languages', warnings, '语言能力为空，已按未填写处理。')
  if (!Array.isArray(output.languages)) return

  let converted = false
  output.languages = output.languages.map((item) => {
    if (!isJsonObject(item) || typeof item.language !== 'string') return item

    const language = item.language.trim()
    const normalizedLanguage = languageAliases.get(language.toLocaleLowerCase()) ?? language
    if (normalizedLanguage === item.language) return item

    converted = true
    return { ...item, language: normalizedLanguage }
  })

  if (converted) warnings.add('语言名称已转换为系统使用的中文名称，请确认熟练度。')
}

function normalizeWorkExperiences(output: JsonObject, warnings: Set<string>) {
  normalizeArrayField(output, 'workExperiences', warnings, '工作经历为空，已按未填写处理。')
  if (!Array.isArray(output.workExperiences)) return

  let converted = false
  let hasIncompleteItem = false
  output.workExperiences = output.workExperiences.map((item) => {
    if (!isJsonObject(item)) return item
    const normalized = { ...item }

    if (typeof normalized.companyName !== 'string' && typeof normalized.company === 'string') {
      normalized.companyName = normalized.company
      converted = true
    }
    if (typeof normalized.jobTitle !== 'string') {
      const alias =
        typeof normalized.title === 'string'
          ? normalized.title
          : typeof normalized.position === 'string'
            ? normalized.position
            : undefined
      if (alias !== undefined) {
        normalized.jobTitle = alias
        converted = true
      }
    }
    if (replaceNullStrings(normalized, ['companyName', 'industry', 'department', 'jobTitle'])) converted = true
    if (!isJsonObject(normalized.period)) {
      const start = typeof normalized.startDate === 'string' ? normalized.startDate : ''
      const end = typeof normalized.endDate === 'string' ? normalized.endDate : ''
      if (start || end || normalized.period === null) {
        normalized.period = { start, end }
        converted = true
      }
    } else if (replaceNullStrings(normalized.period, ['start', 'end'])) {
      converted = true
    }

    const period = normalized.period
    if (
      typeof normalized.companyName !== 'string' ||
      !normalized.companyName.trim() ||
      typeof normalized.jobTitle !== 'string' ||
      !normalized.jobTitle.trim() ||
      !isJsonObject(period) ||
      typeof period.start !== 'string' ||
      !period.start.trim() ||
      typeof period.end !== 'string' ||
      !period.end.trim()
    ) {
      hasIncompleteItem = true
    }

    return normalized
  })

  if (converted) warnings.add('工作经历字段已转换为简历表单格式，请重点核对公司、岗位和时间。')
  if (hasIncompleteItem) warnings.add('部分工作经历缺少公司、岗位或时间，已保留为待确认草稿。')
}

function normalizeProjects(output: JsonObject, warnings: Set<string>) {
  normalizeArrayField(output, 'projects', warnings, '项目经历为空，已按未填写处理。')
  if (!Array.isArray(output.projects)) return

  let normalizedNullFields = false
  let convertedTechStack = false
  let hasIncompleteItem = false
  output.projects = output.projects.map((item) => {
    if (!isJsonObject(item)) return item
    const normalized = { ...item }
    if (replaceNullStrings(normalized, ['name', 'role', 'techStack', 'description', 'content', 'outcomes'])) {
      normalizedNullFields = true
    }
    const techStack = joinStringArray(normalized.techStack, ', ')
    if (techStack !== normalized.techStack) {
      normalized.techStack = techStack
      convertedTechStack = true
    }
    if (typeof normalized.name !== 'string' || !normalized.name.trim()) hasIncompleteItem = true
    return normalized
  })

  if (normalizedNullFields) warnings.add('项目中的空值字段已按未填写处理。')
  if (convertedTechStack) warnings.add('项目技术栈列表已自动合并为文本，请确认内容和顺序。')
  if (hasIncompleteItem) warnings.add('部分项目缺少项目名称，已保留为待确认草稿。')
}

export function normalizeResumePdfModelOutput(value: unknown): ResumePdfOutputNormalizationResult {
  if (!isJsonObject(value)) return { value, warnings: [] }

  const output = { ...value }
  const warnings = new Set<string>()

  if (output.address === null) {
    output.address = []
    warnings.add('期望城市为空，已按未填写处理。')
  } else if (typeof output.address === 'string') {
    output.address = output.address.trim() ? [output.address.trim()] : []
    warnings.add('期望城市已转换为城市列表，请确认结果。')
  }

  const skills = joinStringArray(output.skills, ', ')
  if (skills !== output.skills) {
    output.skills = skills || null
    warnings.add('技能列表已自动合并为文本，请确认内容和顺序。')
  }

  normalizePortfolioLinks(output, warnings)
  normalizeLanguages(output, warnings)
  normalizeWorkExperiences(output, warnings)
  normalizeProjects(output, warnings)

  return { value: output, warnings: [...warnings] }
}
