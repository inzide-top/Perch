export type EmbeddingProviderInput = {
  texts: string[]
  signal: AbortSignal
}

/** 抹平具体 Embedding 服务商差异，索引和查询服务只依赖这一份内部协议。 */
export interface EmbeddingProviderAdapter {
  readonly modelName: string
  readonly dimensions: number
  embed(input: EmbeddingProviderInput): Promise<number[][]>
}
